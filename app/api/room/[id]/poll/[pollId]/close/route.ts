import { NextRequest, NextResponse } from "next/server";
import { closePoll, getPoll, roomExists } from "@/lib/store";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { requireRoomParticipant, isAdmin } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; pollId: string }> },
) {
  const rate = checkRate("poll-close", clientIp(req), 10, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id, pollId } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  const poll = await getPoll(pollId);
  if (!poll || poll.roomId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const canClose = poll.authorId === auth.participant.id || (await isAdmin());
  if (!canClose) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closed = await closePoll({ pollId, closedBy: auth.participant.id });
  if (!closed) {
    return NextResponse.json({ alreadyClosed: true });
  }
  broadcast(id, "poll_closed", closed);
  return NextResponse.json(closed);
}
