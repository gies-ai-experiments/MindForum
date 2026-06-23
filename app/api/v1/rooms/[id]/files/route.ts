import { NextRequest, NextResponse } from "next/server";
import { parseFile } from "@/lib/parse";
import {
  assertActiveRoom,
  checkRoomManager,
  HttpError,
  httpErrorResponse,
} from "@/lib/creator-auth";
import { requireApiKey } from "@/lib/api-key-auth";
import { attachRoomFile } from "@/lib/attach-room-file";
import { getRoomMeta, type Participant } from "@/lib/store";
import { roomIsClosed } from "@/lib/room-state";
import { ATTACH_RATE, MAX_CONTEXT_CHARS } from "@/lib/context-sources";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const API_FILE_DAILY_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Upload a file to a room the API key's creator owns.
 * `multipart/form-data` with a single `file` field — one file per request, like
 * the in-room and dashboard upload routes (callers loop for multiple files).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // Per-IP throttle first, so unauthenticated floods are cheap to reject.
    const ipRate = checkRate(ATTACH_RATE.bucket, clientIp(req), ATTACH_RATE.limit, ATTACH_RATE.windowMs);
    if (!ipRate.allowed) return rateLimited(ipRate.retryAfterSeconds);

    const { id } = await ctx.params;
    const { creator, keyId } = await requireApiKey(req);

    // Ownership: missing room OR not owned → 404 (never leak existence; API
    // creators are never super-admin). Mirrors the invitations endpoint.
    const room = await getRoomMeta(id);
    if (!room) throw new HttpError(404, "not_found");
    await checkRoomManager(creator, room);

    await assertActiveRoom(id);
    // A closed room is locked to new content, same as the participant/dashboard
    // upload routes ("session ended" → don't mutate file context).
    if (await roomIsClosed(id)) return NextResponse.json({ error: "room_closed" }, { status: 410 });

    const dailyRate = checkRate("api-file-daily", keyId, API_FILE_DAILY_LIMIT, DAY_MS);
    if (!dailyRate.allowed) return rateLimited(dailyRate.retryAfterSeconds);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

    const buf = Buffer.from(await file.arrayBuffer());
    let parsed;
    try {
      parsed = await parseFile(file.name, file.type, buf);
    } catch (err) {
      return NextResponse.json(
        { error: "parse_failed", message: (err as Error).message },
        { status: 415 }
      );
    }

    // Synthesise a participant from the creator so attachRoomFile and the audit
    // log have a sensible author, exactly like the dashboard upload route.
    const participant: Participant = {
      id: `creator:${creator.id}`,
      name: creator.displayName,
      email: creator.email,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      mutedAt: null,
      removedAt: null,
    };

    const publicFile = await attachRoomFile({
      roomId: id,
      participant,
      name: file.name,
      mime: parsed.mime,
      sizeBytes: file.size,
      extractedText: parsed.text.slice(0, MAX_CONTEXT_CHARS),
      sourceType: "uploaded",
      sourceUrl: null,
      sourceMeta: null,
    });
    return NextResponse.json({ file: publicFile }, { status: 201 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
