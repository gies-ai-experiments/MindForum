import { NextRequest, NextResponse } from "next/server";
import { parseFile } from "@/lib/parse";
import { assertActiveRoom, httpErrorResponse, requireRoomOwner } from "@/lib/creator-auth";
import { attachRoomFile } from "@/lib/attach-room-file";
import { ATTACH_RATE, MAX_CONTEXT_CHARS } from "@/lib/context-sources";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import type { Participant } from "@/lib/store";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate(ATTACH_RATE.bucket, clientIp(req), ATTACH_RATE.limit, ATTACH_RATE.windowMs);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;

  // Creator auth — owner or super-admin only.
  let actor;
  try {
    const result = await requireRoomOwner(id);
    actor = result.actor;
  } catch (err) {
    return httpErrorResponse(err);
  }

  try {
    await assertActiveRoom(id);
  } catch (err) {
    return httpErrorResponse(err);
  }

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

  // Synthesise a participant record from the creator so attachRoomFile
  // and the audit log have a sensible author.
  const participant: Participant = {
    id: `creator:${actor.id}`,
    name: actor.displayName,
    email: actor.email,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    mutedAt: null,
    removedAt: null,
  };

  try {
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
    return NextResponse.json({ ok: true, file: publicFile });
  } catch (err) {
    console.error("dashboard attach uploaded file failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
