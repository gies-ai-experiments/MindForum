import { NextRequest, NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { createRoomBySlug } from "@/lib/store";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { httpErrorResponse, requireJsonContent } from "@/lib/creator-auth";
import { requireApiKey } from "@/lib/api-key-auth";
import { logAudit } from "@/lib/audit";
import { MAX_SYSTEM_PROMPT_CHARS } from "@/lib/limits";

export const runtime = "nodejs";

const MAX_NAME_CHARS = 100;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const CREATOR_DAILY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
// Lowercase + digits only, so auto-generated slugs always satisfy SLUG_RE.
const slugId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

/** Create a room owned by the API key's creator. Body: { name, systemPrompt?, id? }. */
export async function POST(req: NextRequest) {
  try {
    requireJsonContent(req);

    const ip = clientIp(req);
    const ipRate = checkRate("create-room", ip, 5, 10 * 60 * 1000);
    if (!ipRate.allowed) return rateLimited(ipRate.retryAfterSeconds);

    const { creator } = await requireApiKey(req);

    const creatorRate = checkRate("create-room-creator", creator.id, CREATOR_DAILY_LIMIT, DAY_MS);
    if (!creatorRate.allowed) return rateLimited(creatorRate.retryAfterSeconds);

    const body = await req.json().catch(() => ({}));
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, MAX_NAME_CHARS)
        : "Untitled Room";
    const systemPrompt =
      typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
      return NextResponse.json(
        { error: "system_prompt_too_long", max: MAX_SYSTEM_PROMPT_CHARS, got: systemPrompt.length },
        { status: 400 }
      );
    }

    let slug: string;
    if (typeof body.id === "string" && body.id.trim()) {
      slug = body.id.trim().toLowerCase();
      if (!SLUG_RE.test(slug)) {
        return NextResponse.json(
          { error: "invalid_slug", hint: "lowercase letters, digits, hyphen; 3–40 chars" },
          { status: 400 }
        );
      }
    } else {
      slug = slugId();
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
      metadata: { slug: result.room.id, name: result.room.name, ownerId: result.room.ownerId, via: "api" },
    });
    return NextResponse.json({ id: result.room.id, name: result.room.name }, { status: 201 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
