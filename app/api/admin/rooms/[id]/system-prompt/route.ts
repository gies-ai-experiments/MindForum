import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { setSystemPrompt, roomExists } from "@/lib/store";
import { query } from "@/lib/db";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

const MAX = 4000;

/** Return the current system prompt for the SystemPromptModal to pre-fill. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const { rows } = await query<{ system_prompt: string }>(
    `SELECT system_prompt FROM rooms WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  return NextResponse.json({ systemPrompt: rows[0].system_prompt ?? "" });
}

/** Replace the room's system prompt. Broadcast is fact-only — the new
 *  prompt content is NOT sent over SSE, so non-admin tabs can't sniff it. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.systemPrompt === "string" ? body.systemPrompt : "";
  if (prompt.length > MAX) {
    return NextResponse.json(
      { error: "too_long", max: MAX, got: prompt.length },
      { status: 400 },
    );
  }
  await setSystemPrompt(id, prompt);
  broadcast(id, "system_prompt_updated", { roomId: id });
  console.info({
    adminAction: "system-prompt",
    roomId: id,
    length: prompt.length,
    at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
