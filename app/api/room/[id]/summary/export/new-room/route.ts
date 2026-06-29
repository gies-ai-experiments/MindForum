import { NextRequest, NextResponse } from "next/server";
import { attachRoomFile } from "@/lib/attach-room-file";
import {
  assertActiveRoom,
  checkRoomManager,
  getActor,
  httpErrorResponse,
  requireJsonContent,
} from "@/lib/creator-auth";
import { ATTACH_RATE, MAX_CONTEXT_CHARS } from "@/lib/context-sources";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { createRoomBySlug, upsertParticipant } from "@/lib/store";
import { isValidRoomSlug } from "@/lib/slugify";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_TITLE_CHARS = 80;
const MAX_NAME_CHARS = 100;
// Must match POST /api/room so this path can't be used to bypass the daily cap.
// Same bucket key ("create-room-creator" + creator id) shares the counter.
const CREATOR_DAILY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Export a conversation summary into a BRAND-NEW room, owned by the exporting
 * manager, with the summary attached as the new room's first context file.
 *
 * Auth: the caller must be a MANAGER of the source room (owner / co-admin /
 * super-admin) via checkRoomManager — which guarantees they're an allowlisted
 * creator, so they can legally own the new room (rooms.owner_id → creators).
 * checkRoomManager throws 404 (not 403) on denial, matching the repo's
 * existence-hiding convention. Non-managers never reach this from the UI (the
 * Settings entry is manager-gated); this is the server-side enforcement.
 *
 * Sibling to ../route.ts (export into an EXISTING room).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate(ATTACH_RATE.bucket, clientIp(req), ATTACH_RATE.limit, ATTACH_RATE.windowMs);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  try {
    requireJsonContent(req);
    const { id: sourceRoomId } = await ctx.params;
    const sourceRoom = await assertActiveRoom(sourceRoomId);

    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Throws HttpError(404) if the actor isn't a manager of the source room.
    await checkRoomManager(actor, { id: sourceRoom.id, ownerId: sourceRoom.ownerId });

    // Per-creator daily room-creation cap, shared with POST /api/room.
    const capped = checkRate("create-room-creator", actor.id, CREATOR_DAILY_LIMIT, DAY_MS);
    if (!capped.allowed) return rateLimited(capped.retryAfterSeconds);

    const body = await req.json().catch(() => ({}));
    const slug = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    const name = (rawName || "Untitled Room").slice(0, MAX_NAME_CHARS);
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    const requestedTitle = typeof body.title === "string" ? body.title.trim() : "";

    if (!isValidRoomSlug(slug)) {
      return NextResponse.json(
        { error: "invalid_slug", hint: "lowercase letters, digits, hyphen; 3–40 chars" },
        { status: 400 }
      );
    }
    if (!summary) return NextResponse.json({ error: "summary_required" }, { status: 400 });
    if (summary.length > MAX_CONTEXT_CHARS) {
      return NextResponse.json({ error: "summary_too_long", max: MAX_CONTEXT_CHARS }, { status: 400 });
    }

    // Create the room owned by the exporting manager.
    const result = await createRoomBySlug({
      id: slug,
      name,
      systemPrompt: "",
      createdById: actor.id,
      ownerId: actor.id,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ownerDisplayName: result.ownerDisplayName },
        { status: 409 }
      );
    }

    // Add the owner as the new room's first participant so the context file has
    // an uploader to attribute (attachRoomFile needs a Participant), and so the
    // owner is already a member when they open it.
    const participant = await upsertParticipant(result.room.id, actor.displayName, actor.email);
    if (!participant) return NextResponse.json({ error: "db_error" }, { status: 500 });

    const title = (requestedTitle || `Meeting summary from ${sourceRoom.name}`).slice(0, MAX_TITLE_CHARS);
    const extractedText = `# ${title}\n\n${summary}`;
    const file = await attachRoomFile({
      roomId: result.room.id,
      participant,
      name: title,
      mime: "text/markdown",
      sizeBytes: Buffer.byteLength(extractedText, "utf8"),
      extractedText,
      sourceType: "pasted_text",
      sourceUrl: null,
      sourceMeta: { charCount: extractedText.length },
    });

    await logAudit({
      actor: { id: actor.id, email: actor.email },
      action: "room.create",
      roomId: result.room.id,
      metadata: { slug, name, ownerId: actor.id, via: "summary_export", sourceRoomId },
    });

    return NextResponse.json({ ok: true, roomId: result.room.id, file });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
