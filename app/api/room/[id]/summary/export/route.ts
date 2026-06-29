import { NextRequest, NextResponse } from "next/server";
import { attachRoomFile } from "@/lib/attach-room-file";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { assertActiveRoom, httpErrorResponse, requireJsonContent } from "@/lib/creator-auth";
import { query } from "@/lib/db";
import { ATTACH_RATE, MAX_CONTEXT_CHARS } from "@/lib/context-sources";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { roomIsClosed } from "@/lib/room-state";
import type { Participant } from "@/lib/store";

export const runtime = "nodejs";

const MAX_TITLE_CHARS = 80;

type ParticipantRow = {
  id: string;
  name: string;
  email: string;
  joined_at: Date;
  last_seen_at: Date | null;
  muted_at: Date | null;
  removed_at: Date | null;
};

function toParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    joinedAt: row.joined_at.getTime(),
    lastSeenAt: row.last_seen_at ? row.last_seen_at.getTime() : null,
    mutedAt: row.muted_at ? row.muted_at.getTime() : null,
    removedAt: row.removed_at ? row.removed_at.getTime() : null,
  };
}

async function participantByEmail(roomId: string, email: string): Promise<Participant | null> {
  const { rows } = await query<ParticipantRow>(
    `SELECT id, name, email, joined_at, last_seen_at, muted_at, removed_at
       FROM participants
      WHERE room_id = $1 AND lower(email) = lower($2) AND removed_at IS NULL
      LIMIT 1`,
    [roomId, email]
  );
  return rows[0] ? toParticipant(rows[0]) : null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate(ATTACH_RATE.bucket, clientIp(req), ATTACH_RATE.limit, ATTACH_RATE.windowMs);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  try {
    requireJsonContent(req);
    const { id: sourceRoomId } = await ctx.params;
    const sourceRoom = await assertActiveRoom(sourceRoomId);

    const auth = await requireRoomParticipant(req, sourceRoomId);
    if (!auth.ok) return auth.response;
    if (auth.participant.mutedAt != null) return NextResponse.json({ ok: true });

    const body = await req.json().catch(() => ({}));
    const destinationRoomId = typeof body.destinationRoomId === "string" ? body.destinationRoomId.trim() : "";
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    const requestedTitle = typeof body.title === "string" ? body.title.trim() : "";

    if (!destinationRoomId) return NextResponse.json({ error: "destination_required" }, { status: 400 });
    if (!summary) return NextResponse.json({ error: "summary_required" }, { status: 400 });
    if (summary.length > MAX_CONTEXT_CHARS) {
      return NextResponse.json({ error: "summary_too_long", max: MAX_CONTEXT_CHARS }, { status: 400 });
    }

    await assertActiveRoom(destinationRoomId);
    if (await roomIsClosed(destinationRoomId)) {
      return NextResponse.json({ error: "room_closed" }, { status: 410 });
    }

    const destinationParticipant = await participantByEmail(destinationRoomId, auth.participant.email);
    if (!destinationParticipant) {
      return NextResponse.json({ error: "destination_not_joined" }, { status: 403 });
    }
    if (destinationParticipant.mutedAt != null) return NextResponse.json({ ok: true });

    const title = (requestedTitle || `Meeting summary from ${sourceRoom.name}`).slice(0, MAX_TITLE_CHARS);
    const extractedText = `# ${title}\n\n${summary}`;
    const file = await attachRoomFile({
      roomId: destinationRoomId,
      participant: destinationParticipant,
      name: title,
      mime: "text/markdown",
      sizeBytes: Buffer.byteLength(extractedText, "utf8"),
      extractedText,
      sourceType: "pasted_text",
      sourceUrl: null,
      sourceMeta: { charCount: extractedText.length },
    });

    return NextResponse.json({ ok: true, file });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
