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
import crypto from "crypto";
import { query } from "./db";
import { isAdmin } from "./admin-auth";

export const CREATOR_COOKIE = "mindforum_creator_session";
export const CREATOR_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365; // 1y

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
 * Resolve the current actor — either a creator (via cookie) or the super-admin
 * (via ADMIN_TOKEN cookie). When admin is authenticated, returns the synthetic
 * 'cr_super_admin' row so callers always have a valid actor_id to log against.
 *
 * Returns null if neither path authenticates.
 */
export async function getActor(): Promise<Creator | null> {
  const creator = await getCreator();
  if (creator) return creator;
  if (await isAdmin()) {
    const { rows } = await query<CreatorRow>(
      `SELECT id, email, display_name, is_super_admin, disabled_at
         FROM allowlisted_creators
        WHERE id = 'cr_super_admin'
        LIMIT 1`
    );
    return rows[0] ? toCreator(rows[0]) : null;
  }
  return null;
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
