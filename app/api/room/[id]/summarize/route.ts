import { NextRequest, NextResponse } from "next/server";
import {
  appendMessage,
  getRecentMessages,
  type Message,
} from "@/lib/store";
import { query } from "@/lib/db";
import { broadcast } from "@/lib/sse";
import { generateSummary } from "@/lib/openai";
import { validateSummaryRequest } from "@/lib/summary-input";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { roomIsClosed } from "@/lib/room-state";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("summarize", clientIp(req), 3, 5 * 60 * 1000);
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

  // Shadow-mute parity: muted participants get a fake success and post nothing.
  if (participant.mutedAt != null) {
    return NextResponse.json({ ok: true });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = validateSummaryRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let summary: string;
  try {
    if (parsed.value.source === "text") {
      summary = await generateSummary({ mode: "text", text: parsed.value.text });
    } else {
      const [messages, promptRow] = await Promise.all([
        getRecentMessages(id, 100),
        query<{ system_prompt: string }>(`SELECT system_prompt FROM rooms WHERE id = $1`, [id]),
      ]);
      summary = await generateSummary({
        mode: "room",
        messages,
        systemPrompt: promptRow.rows[0]?.system_prompt ?? "",
      });
    }
  } catch (err) {
    console.error("generateSummary failed:", err);
    return NextResponse.json({ error: "llm_error" }, { status: 500 });
  }

  const header =
    parsed.value.source === "text"
      ? `> _Summary of pasted text · requested by ${participant.name}_`
      : `> _Summary · requested by ${participant.name}_`;

  const msg: Message = {
    id: nanoid(10),
    roomId: id,
    authorId: "ai",
    authorName: "AI",
    content: `${header}\n\n${summary}`,
    createdAt: Date.now(),
    kind: "summary",
  };

  try {
    await appendMessage(msg);
  } catch (err) {
    console.error("append summary failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  broadcast(id, "message_added", msg);
  return NextResponse.json({ ok: true, id: msg.id });
}
