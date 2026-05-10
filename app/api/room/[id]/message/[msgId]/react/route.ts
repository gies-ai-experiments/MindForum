import { NextRequest, NextResponse } from "next/server";
import {
  getMessageRoomId,
  getParticipant,
  getReactionsForMessage,
  toggleReaction,
} from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";

export const runtime = "nodejs";

const MAX_EMOJI_LEN = 16;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; msgId: string }> }
) {
  const rate = checkRate("react", clientIp(req), 60, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id, msgId } = await ctx.params;
  try {
    await assertActiveRoom(id);
  } catch (err) {
    return httpErrorResponse(err);
  }

  const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
  const participant = pid ? await getParticipant(id, pid) : null;
  if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });

  // Confirm the message exists and lives in this room — keeps a participant
  // in room A from reacting to a message in room B.
  const ownerRoom = await getMessageRoomId(msgId);
  if (ownerRoom !== id) {
    return NextResponse.json({ error: "message_not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
  if (!emoji || emoji.length > MAX_EMOJI_LEN) {
    return NextResponse.json({ error: "invalid_emoji" }, { status: 400 });
  }

  try {
    const result = await toggleReaction(msgId, participant.id, emoji);
    const reactions = await getReactionsForMessage(msgId);
    broadcast(id, "reaction_changed", { messageId: msgId, reactions });
    return NextResponse.json({ ok: true, added: result.added, reactions });
  } catch (err) {
    console.error("toggleReaction failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
