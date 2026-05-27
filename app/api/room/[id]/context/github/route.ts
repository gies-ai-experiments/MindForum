import { NextRequest, NextResponse } from "next/server";
import { ATTACH_RATE } from "@/lib/context-sources";
import { attachRoomFile } from "@/lib/attach-room-file";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { assertActiveRoom, httpErrorResponse } from "@/lib/creator-auth";
import { ingestGitHubRepo, splitGlobs } from "@/lib/ingest/github";
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
  const include = parseGlobInput(body.include);
  const exclude = parseGlobInput(body.exclude);

  try {
    const ingested = await ingestGitHubRepo({ url, include, exclude });
    const file = await attachRoomFile({
      roomId: id,
      participant: auth.participant,
      name: ingested.name,
      mime: ingested.mime,
      sizeBytes: ingested.sizeBytes,
      extractedText: ingested.extractedText,
      sourceType: "github_repo",
      sourceUrl: ingested.sourceUrl,
      sourceMeta: ingested.sourceMeta,
    });
    return NextResponse.json({ ok: true, file });
  } catch (err) {
    return githubErrorResponse(err);
  }
}

function parseGlobInput(value: unknown): string[] | undefined {
  if (typeof value === "string") return splitGlobs(value, []);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return splitGlobs(value, []);
  }
  return undefined;
}

function githubErrorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "";
  if (message === "invalid_github_url") return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  if (message === "github_repo_not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (message === "github_rate_limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (message === "github_fetch_timeout") return NextResponse.json({ error: "timeout" }, { status: 504 });
  if (
    message === "github_tarball_too_large" ||
    message === "github_repo_too_large" ||
    message.startsWith("too_large")
  ) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  console.error("github context attach failed:", err);
  return NextResponse.json({ error: "context_attach_failed" }, { status: 500 });
}
