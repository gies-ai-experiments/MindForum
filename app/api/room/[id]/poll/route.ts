import { NextRequest, NextResponse } from "next/server";
import { createPoll, roomExists } from "@/lib/store";
import { validateOptions } from "@/lib/poll-logic";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

const DURATION_MS: Record<string, number | null> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "manual": null,
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("poll-create", clientIp(req), 5, 10 * 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  let body: { question?: unknown; options?: unknown; duration?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "empty_question" }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ error: "question_too_long" }, { status: 400 });

  const rawOptions = Array.isArray(body.options) ? body.options.map(String) : [];
  const v = validateOptions(rawOptions);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const duration = typeof body.duration === "string" ? body.duration : "1h";
  if (!(duration in DURATION_MS)) {
    return NextResponse.json({ error: "bad_duration" }, { status: 400 });
  }
  const ms = DURATION_MS[duration];
  const closesAt = ms == null ? null : new Date(Date.now() + ms);

  const poll = await createPoll({
    roomId: id,
    authorId: auth.participant.id,
    question,
    options: v.normalized,
    closesAt,
  });

  broadcast(id, "poll_opened", {
    pollId: poll.id,
    roomId: poll.roomId,
    question: poll.question,
    options: poll.options,
    closesAt: poll.closesAt,
    authorId: poll.authorId,
    authorName: poll.authorName,
    createdAt: poll.createdAt,
  });

  return NextResponse.json(poll);
}
