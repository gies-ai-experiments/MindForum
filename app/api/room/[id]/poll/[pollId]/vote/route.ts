import { NextRequest, NextResponse } from "next/server";
import { castVote, closeExpiredPolls, roomExists } from "@/lib/store";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; pollId: string }> },
) {
  const rate = checkRate("poll-vote", clientIp(req), 30, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id, pollId } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  // Lazy-close first — voter might be trying to vote on an expired poll.
  const newlyClosed = await closeExpiredPolls(id);
  for (const c of newlyClosed) {
    broadcast(id, "poll_closed", c);
  }

  const body = await req.json().catch(() => ({}));
  const optionId = typeof body.optionId === "string" ? body.optionId : "";
  if (!optionId) return NextResponse.json({ error: "missing_option" }, { status: 400 });

  try {
    const { totalVotes } = await castVote({
      pollId,
      participantId: auth.participant.id,
      optionId,
    });
    broadcast(id, "poll_vote", { pollId, totalVotes });
    return NextResponse.json({ totalVotes });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "poll_not_open") {
      const closed = newlyClosed.find(p => p.id === pollId) ?? null;
      return NextResponse.json({ error: "poll_closed", closed }, { status: 409 });
    }
    if (msg === "invalid_option") {
      return NextResponse.json({ error: "invalid_option" }, { status: 400 });
    }
    throw e;
  }
}
