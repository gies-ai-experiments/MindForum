import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { getCreator } from "@/lib/creator-auth";
import { parsePromptGenInput } from "@/lib/prompt-gen";
import { generateSystemPrompt } from "@/lib/openai";

export const runtime = "nodejs";

/**
 * POST /api/generate-prompt
 * Body: { description: string }  ->  { prompt: string }
 *
 * Rewrites a plain-English description into a structured room system prompt via
 * a one-shot LLM call. Auth mirrors POST /api/room: an `x-admin-token` header
 * (landing admin create card) OR a creator session cookie (dashboard create,
 * dashboard settings, in-room settings modal — all carry the creator cookie).
 * Rate-limited per IP because each call costs an LLM completion.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rate = checkRate("promptgen", ip, 10, 10 * 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }

  // Auth: admin header first (the landing card holds the token in localStorage
  // and sends it as a header, not a cookie), then the creator cookie. Either
  // alone is sufficient.
  let authed = false;
  const adminToken = process.env.ADMIN_TOKEN;
  const supplied = req.headers.get("x-admin-token");
  if (adminToken && supplied) {
    const a = Buffer.from(adminToken);
    const b = Buffer.from(supplied);
    authed = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!authed) {
    authed = (await getCreator()) !== null;
  }
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = parsePromptGenInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const prompt = await generateSystemPrompt(parsed.description);
    if (!prompt) {
      return NextResponse.json({ error: "generation_failed" }, { status: 502 });
    }
    return NextResponse.json({ prompt });
  } catch (err) {
    console.error("generate-prompt failed:", err);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}
