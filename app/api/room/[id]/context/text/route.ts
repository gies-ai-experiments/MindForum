import { NextRequest, NextResponse } from "next/server";
import { ATTACH_RATE, MAX_CONTEXT_CHARS } from "@/lib/context-sources";
import { attachRoomFile } from "@/lib/attach-room-file";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";
import { roomIsClosed } from "@/lib/room-state";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

const MAX_TITLE_CHARS = 80;

function deriveName(title: string, text: string): string {
  const trimmedTitle = title.trim();
  if (trimmedTitle) return trimmedTitle.slice(0, MAX_TITLE_CHARS);
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) return firstLine.slice(0, MAX_TITLE_CHARS);
  return "Pasted note";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate(ATTACH_RATE.bucket, clientIp(req), ATTACH_RATE.limit, ATTACH_RATE.windowMs);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  try {
    await assertActiveRoom(id);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (await roomIsClosed(id)) return NextResponse.json({ error: "room_closed" }, { status: 410 });

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return NextResponse.json({ error: "text_required" }, { status: 400 });

  const extractedText = text.slice(0, MAX_CONTEXT_CHARS);

  try {
    const file = await attachRoomFile({
      roomId: id,
      participant: auth.participant,
      name: deriveName(title, extractedText),
      mime: "text/plain",
      sizeBytes: Buffer.byteLength(extractedText, "utf8"),
      extractedText,
      sourceType: "pasted_text",
      sourceUrl: null,
      sourceMeta: { charCount: extractedText.length },
    });
    return NextResponse.json({ ok: true, file });
  } catch (err) {
    console.error("pasted text context attach failed:", err);
    return NextResponse.json({ error: "context_attach_failed" }, { status: 500 });
  }
}
