import { NextRequest, NextResponse } from "next/server";
import { parseFile } from "@/lib/parse";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { roomIsClosed } from "@/lib/room-state";
import { attachRoomFile } from "@/lib/attach-room-file";
import { ATTACH_RATE, MAX_CONTEXT_CHARS } from "@/lib/context-sources";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate(ATTACH_RATE.bucket, clientIp(req), ATTACH_RATE.limit, ATTACH_RATE.windowMs);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  try {
    await assertActiveRoom(id);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (await roomIsClosed(id)) {
    return NextResponse.json({ error: "room_closed" }, { status: 410 });
  }

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;
  const participant = auth.participant;

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
    console.error("attach uploaded file failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
