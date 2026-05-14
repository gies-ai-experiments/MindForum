import { NextRequest, NextResponse } from "next/server";
import { getRecentMessages, roomExists } from "@/lib/store";
import { query } from "@/lib/db";
import { draftPollFromHistory } from "@/lib/openai";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { requireRoomParticipant } from "@/lib/auth-helpers";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("poll-draft", clientIp(req), 5, 5 * 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  const [recent, promptRow] = await Promise.all([
    getRecentMessages(id, 20),
    query<{ system_prompt: string }>(
      `SELECT system_prompt FROM rooms WHERE id = $1`,
      [id],
    ),
  ]);
  const chatHistory = recent.filter(m => !m.kind || m.kind === "chat");
  const systemPrompt = promptRow.rows[0]?.system_prompt ?? "";

  try {
    const draft = await draftPollFromHistory(chatHistory, systemPrompt);
    return NextResponse.json(draft);
  } catch {
    return NextResponse.json({ question: "", options: [] });
  }
}
