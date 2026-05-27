import { NextRequest, NextResponse } from "next/server";
import { ATTACH_RATE } from "@/lib/context-sources";
import { attachRoomFile } from "@/lib/attach-room-file";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";
import { ingestUrl } from "@/lib/ingest/url";
import { roomIsClosed } from "@/lib/room-state";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

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
  const url = typeof body.url === "string" ? body.url : "";
  const instruction = typeof body.instruction === "string" ? body.instruction : "";

  try {
    const ingested = await ingestUrl({ url, instruction });
    const file = await attachRoomFile({
      roomId: id,
      participant: auth.participant,
      name: ingested.name,
      mime: ingested.mime,
      sizeBytes: ingested.sizeBytes,
      extractedText: ingested.extractedText,
      sourceType: "web_url",
      sourceUrl: ingested.sourceUrl,
      sourceMeta: ingested.sourceMeta,
    });
    return NextResponse.json({ ok: true, file });
  } catch (err) {
    return urlErrorResponse(err);
  }
}

function urlErrorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "";
  if (message === "invalid_url") return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  if (message === "instruction_required") {
    return NextResponse.json({ error: "instruction_required" }, { status: 400 });
  }
  if (message.startsWith("too_large")) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (message === "unsupported_content_type") {
    return NextResponse.json({ error: "unsupported_content_type" }, { status: 415 });
  }
  if (message === "no_readable_text") {
    return NextResponse.json({ error: "no_readable_text" }, { status: 422 });
  }
  if (message === "too_many_redirects" || message === "invalid_redirect") {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }
  if (message === "url_fetch_timeout") return NextResponse.json({ error: "timeout" }, { status: 504 });
  console.error("url context attach failed:", err);
  return NextResponse.json({ error: "context_attach_failed" }, { status: 500 });
}
