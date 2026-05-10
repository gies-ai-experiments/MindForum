import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createRoom, createRoomBySlug } from "@/lib/store";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { getCreator, httpErrorResponse } from "@/lib/creator-auth";
import { logAudit } from "@/lib/audit";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

// Bumped from 4000 → 51200 per the v1 creator-rooms spec (50 KB cap; existing
// seeded prompts are well under 10 KB, so this leaves room for richer
// facilitator scripts without enabling abuse).
const MAX_SYSTEM_PROMPT_CHARS = 51_200;
const MAX_NAME_CHARS = 100;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

// Per-creator daily cap on room creation (in-memory, like the IP limiter).
// Resets on process restart.
const CREATOR_DAILY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Create a room. Two distinct call shapes (auth resolution: header first,
 * then cookie):
 *
 *   1. Legacy admin path: `x-admin-token` header, body { name, systemPrompt? }.
 *      Server generates a random nanoid(10) slug. Owner = synthetic super-admin.
 *      Used by the homepage form and any existing scripts.
 *
 *   2. Creator path: `mindforum_creator_session` cookie, body
 *      { id, name, systemPrompt? } where `id` is the slug. Slug uniqueness
 *      is global, first-come-first-served. On collision: 409 with the
 *      colliding owner's display name. Owner = the authenticated creator.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ipRate = checkRate("create-room", ip, 5, 10 * 60 * 1000);
  if (!ipRate.allowed) return rateLimited(ipRate.retryAfterSeconds);

  // Auth: header first (legacy admin path). The synthetic super-admin row's
  // sentinel token_hash cannot match any real sha256(token), so super-admin
  // can never authenticate via the cookie path — the two paths are
  // independent by construction.
  const adminToken = process.env.ADMIN_TOKEN;
  const supplied = req.headers.get("x-admin-token");
  let isAdminHeader = false;
  if (adminToken && supplied !== null) {
    const a = Buffer.from(adminToken);
    const b = Buffer.from(supplied);
    isAdminHeader = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!isAdminHeader) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, MAX_NAME_CHARS)
      : "Untitled Room";
  const systemPrompt =
    typeof body.systemPrompt === "string"
      ? body.systemPrompt.trim().slice(0, MAX_SYSTEM_PROMPT_CHARS)
      : "";

  // Legacy / admin path: header valid (or admin disabled). Auto-generate slug.
  if (isAdminHeader || !adminToken) {
    const createdById = nanoid(10);
    try {
      const room = await createRoom(name, createdById, systemPrompt);
      return NextResponse.json({ id: room.id, name: room.name });
    } catch (err) {
      console.error("createRoom failed:", err);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
  }

  // Creator path: header absent, fall through to cookie auth.
  try {
    const creator = await getCreator();
    if (!creator) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const creatorRate = checkRate(
      "create-room-creator",
      creator.id,
      CREATOR_DAILY_LIMIT,
      DAY_MS
    );
    if (!creatorRate.allowed) return rateLimited(creatorRate.retryAfterSeconds);

    const slug = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: "invalid_slug", hint: "lowercase letters, digits, hyphen; 3–40 chars" },
        { status: 400 }
      );
    }

    const result = await createRoomBySlug({
      id: slug,
      name,
      systemPrompt,
      createdById: creator.id,
      ownerId: creator.id,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ownerDisplayName: result.ownerDisplayName },
        { status: 409 }
      );
    }
    await logAudit({
      actor: creator,
      action: "room.create",
      roomId: result.room.id,
      metadata: {
        slug: result.room.id,
        name: result.room.name,
        ownerId: result.room.ownerId,
      },
    });
    return NextResponse.json({ id: result.room.id, name: result.room.name });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
