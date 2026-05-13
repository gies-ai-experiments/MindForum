// Creator-token authentication for the v1 creator-rooms feature.
//
// Tokens are 32 random bytes, base64url-encoded (~43 chars), shown to the
// super-admin once at create/rotate time. We store sha256(plaintext) only;
// the cookie value IS the plaintext token, hashed per request to look up the
// row.
//
// Super-admin uses ADMIN_TOKEN (lib/admin-auth.ts) — independent path. The
// synthetic 'cr_super_admin' row in allowlisted_creators has a sentinel
// token_hash that no real sha256(token) can match, so the creator-cookie
// path is creator-only by construction.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "./db";
import { isAdmin } from "./admin-auth";
import {
  createCreator,
  getRoomMeta,
  rotateCreatorTokenHash,
  type AllowlistedCreator,
  type RoomMeta,
} from "./store";

export { CREATOR_COOKIE, CREATOR_COOKIE_MAX_AGE_S } from "./creator-cookie";
import { CREATOR_COOKIE } from "./creator-cookie";

export type Creator = {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  disabledAt: number | null;
};

type CreatorRow = {
  id: string;
  email: string;
  display_name: string;
  is_super_admin: boolean;
  disabled_at: Date | null;
};

function toCreator(r: CreatorRow): Creator {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    isSuperAdmin: r.is_super_admin,
    disabledAt: r.disabled_at ? r.disabled_at.getTime() : null,
  };
}

/** Generate a fresh plaintext token. 32 random bytes, base64url. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Hash a plaintext token for storage / lookup. */
export function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

/** Last-4 of the plaintext token, for display. */
export function lastFour(plaintext: string): string {
  return plaintext.slice(-4);
}

/**
 * Look up a creator by plaintext token. Returns null if no row matches or the
 * creator is disabled. Comparison goes through the unique index on token_hash;
 * the index is on the deterministic hash, so there's no timing leak across
 * rows. We still timingSafeEqual the returned hash against the recomputed one
 * as belt-and-suspenders against any future schema change.
 */
async function findByToken(plaintext: string): Promise<Creator | null> {
  if (!plaintext) return null;
  const h = hashToken(plaintext);
  const { rows } = await query<CreatorRow & { token_hash: string }>(
    `SELECT id, email, display_name, is_super_admin, disabled_at, token_hash
       FROM allowlisted_creators
      WHERE token_hash = $1
      LIMIT 1`,
    [h]
  );
  const r = rows[0];
  if (!r) return null;
  // Defensive constant-time recheck.
  const a = Buffer.from(h);
  const b = Buffer.from(r.token_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (r.disabled_at) return null;
  return toCreator(r);
}

/**
 * Resolve the current creator from the request cookie. Returns null if no
 * cookie, invalid token, or disabled creator. Does NOT consult ADMIN_TOKEN —
 * super-admin uses a separate auth path.
 */
export async function getCreator(): Promise<Creator | null> {
  const c = await cookies();
  const tok = c.get(CREATOR_COOKIE)?.value;
  if (!tok) return null;
  return findByToken(tok);
}

/**
 * Resolve the current actor — either the super-admin (via ADMIN_TOKEN cookie)
 * or a creator (via creator cookie). Admin is checked FIRST so an operator
 * who has both cookies (e.g. testing a creator session in the same browser)
 * keeps their super-admin authority on cross-owner rooms — otherwise the
 * creator-cookie path would fail ownership and 404 the operator out of their
 * own admin tools. Audit attribution lands on `cr_super_admin` in this case,
 * which is the right reflection of the privilege actually exercised.
 *
 * Returns null if neither path authenticates.
 */
export async function getActor(): Promise<Creator | null> {
  if (await isAdmin()) {
    const { rows } = await query<CreatorRow>(
      `SELECT id, email, display_name, is_super_admin, disabled_at
         FROM allowlisted_creators
        WHERE id = 'cr_super_admin'
        LIMIT 1`
    );
    if (rows[0]) return toCreator(rows[0]);
  }
  return getCreator();
}

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

/** Throws HttpError(401) if no valid creator cookie. */
export async function requireCreator(): Promise<Creator> {
  const c = await getCreator();
  if (!c) throw new HttpError(401, "unauthorized");
  return c;
}

/**
 * Resolve the actor and check ownership of the given room. Super-admin passes
 * regardless of owner. Returns 404 (not 403) on cross-owner access so room
 * existence isn't leaked.
 *
 * Caller must ensure the room exists and pass its owner_id and id.
 */
export function checkRoomOwner(
  actor: Creator,
  room: { id: string; ownerId: string }
): void {
  if (actor.isSuperAdmin) return;
  if (room.ownerId !== actor.id) {
    throw new HttpError(404, "not_found");
  }
}

/** Sign-in: validate token, return the creator (caller sets the cookie). */
export async function authenticateToken(plaintext: string): Promise<Creator | null> {
  return findByToken(plaintext);
}

// -------- Route-layer helpers
//
// These wrap the store and the auth primitives so handlers stay thin.
// Plaintext tokens never enter or leave the store layer; they're generated
// here, hashed, and the hash + last-4 are persisted.

/**
 * Create a new allowlisted creator. Generates the plaintext token, hashes it,
 * and surfaces the plaintext exactly once for the operator to copy. Email
 * collisions return `email_taken` so the route can render a friendly message.
 */
export async function provisionCreator(input: {
  email: string;
  displayName: string;
  createdBy: string | null;
}): Promise<
  | { ok: true; creator: AllowlistedCreator; plaintextToken: string }
  | { ok: false; error: "email_taken" }
> {
  const plaintext = generateToken();
  const tokenHash = hashToken(plaintext);
  const tokenLastFour = lastFour(plaintext);
  const r = await createCreator({
    email: input.email,
    displayName: input.displayName,
    tokenHash,
    tokenLastFour,
    createdBy: input.createdBy,
  });
  if (!r.ok) return r;
  return { ok: true, creator: r.creator, plaintextToken: plaintext };
}

/**
 * Generate a fresh token for an existing creator. Old cookie stops working
 * on the next request (lookup is by token_hash). Refused on the synthetic
 * super-admin row — its sentinel hash must remain unreachable.
 */
export async function regenerateCreatorToken(id: string): Promise<
  | { ok: true; plaintextToken: string }
  | { ok: false; error: "not_found" | "is_super_admin" }
> {
  if (id === "cr_super_admin") return { ok: false, error: "is_super_admin" };
  const plaintext = generateToken();
  const tokenHash = hashToken(plaintext);
  const tokenLastFour = lastFour(plaintext);
  const ok = await rotateCreatorTokenHash(id, tokenHash, tokenLastFour);
  if (!ok) return { ok: false, error: "not_found" };
  return { ok: true, plaintextToken: plaintext };
}

/**
 * Resolve actor and assert ownership of `roomId`. Super-admin (via
 * ADMIN_TOKEN cookie) passes regardless of owner. Returns 404 (not 403) for
 * cross-owner access so room existence isn't leaked. 401 if no actor.
 */
export async function requireRoomOwner(
  roomId: string
): Promise<{ actor: Creator; room: RoomMeta }> {
  const actor = await getActor();
  if (!actor) throw new HttpError(401, "unauthorized");
  const room = await getRoomMeta(roomId);
  if (!room) throw new HttpError(404, "not_found");
  checkRoomOwner(actor, room);
  return { actor, room };
}

/**
 * Convert a thrown `HttpError` (or any error) into a JSON response. Anything
 * non-HttpError is logged and surfaced as a generic 500 — never leak internal
 * details to the client.
 */
export function httpErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.code }, { status: err.status });
  }
  console.error("unexpected route error:", err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}

/**
 * CSRF defense for new JSON endpoints: SameSite=Lax cookies aren't sent on
 * cross-site form POSTs that lack the `application/json` content type, so
 * requiring it is sufficient for v1. Throws HttpError(415).
 */
export function requireJsonContent(req: Request): void {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type");
  }
}

/**
 * Used by participant write paths to enforce the soft-delete contract: an
 * archived room rejects every write with 410 Gone, regardless of who's
 * asking (owner included — per spec, "edits to archived rooms require
 * restore first"). Returns the room meta on success so the caller can
 * reuse it without an extra round-trip.
 */
export async function assertActiveRoom(roomId: string): Promise<RoomMeta> {
  const room = await getRoomMeta(roomId);
  if (!room) throw new HttpError(404, "not_found");
  if (room.archivedAt !== null) throw new HttpError(410, "archived");
  return room;
}

/**
 * Used by read paths that should still serve owner / super-admin on archived
 * rooms (catchup, brief, file preview, SSE init snapshot). Returns whether
 * the requester is the owner so the caller can adjust behavior (e.g. SSE
 * stops broadcasting live events for archived rooms regardless).
 */
export async function assertActiveOrOwnerOnArchive(
  roomId: string
): Promise<{ room: RoomMeta; isOwner: boolean; archived: boolean }> {
  const room = await getRoomMeta(roomId);
  if (!room) throw new HttpError(404, "not_found");
  if (room.archivedAt === null) {
    return { room, isOwner: false, archived: false };
  }
  const actor = await getActor();
  const isOwner = !!actor && (actor.isSuperAdmin || room.ownerId === actor.id);
  if (!isOwner) throw new HttpError(410, "archived");
  return { room, isOwner: true, archived: true };
}
