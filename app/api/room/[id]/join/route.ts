import { NextRequest, NextResponse } from "next/server";
import {
  upsertParticipant,
  getParticipant,
  countMessagesAfter,
} from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import {
  assertActiveRoom,
  getActor,
  HttpError,
  httpErrorResponse,
} from "@/lib/creator-auth";
import { getRoomMeta } from "@/lib/store";

export const runtime = "nodejs";

const REJOIN_THRESHOLD_MS = 15 * 60 * 1000;

type CatchupHint = { should: false } | { should: true; since: number | null };

async function computeHint(
  roomId: string,
  isFirstTime: boolean,
  lastSeenAt: number | null
): Promise<CatchupHint> {
  if (isFirstTime || lastSeenAt == null) {
    return { should: true, since: null };
  }
  const elapsed = Date.now() - lastSeenAt;
  if (elapsed < REJOIN_THRESHOLD_MS) {
    return { should: false };
  }
  const newMessages = await countMessagesAfter(roomId, lastSeenAt);
  if (newMessages === 0) {
    return { should: false };
  }
  return { should: true, since: lastSeenAt };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = checkRate("join", clientIp(req), 10, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const { id } = await ctx.params;
  try {
    await assertActiveRoom(id);
  } catch (err) {
    // Owner / super-admin viewing an archived room they own: skip the
    // participant upsert (which is blocked by assertActiveRoom anyway) and
    // return a read-only handshake. The page uses this to open the SSE
    // snapshot without a participant cookie; SSE itself enforces ownership
    // via assertActiveOrOwnerOnArchive, so this is just a UX shortcut.
    if (err instanceof HttpError && err.status === 410) {
      const room = await getRoomMeta(id);
      const actor = await getActor();
      const isOwner =
        !!room && !!actor && (actor.isSuperAdmin || room.ownerId === actor.id);
      if (isOwner) {
        return NextResponse.json({
          participantId: null,
          readOnly: true,
          archived: true,
          catchupHint: { should: false },
        });
      }
    }
    return httpErrorResponse(err);
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
  if (!name || !email) {
    return NextResponse.json({ error: "name_and_email_required" }, { status: 400 });
  }

  const cookieName = `mindforum_pid_${id}`;
  const existingPid = req.cookies.get(cookieName)?.value;
  if (existingPid) {
    const existing = await getParticipant(id, existingPid);
    if (existing) {
      const hint = await computeHint(id, false, existing.lastSeenAt);
      return NextResponse.json({ participantId: existing.id, catchupHint: hint });
    }
  }

  let participant;
  try {
    participant = await upsertParticipant(id, name, email);
  } catch (err) {
    console.error("upsertParticipant failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!participant) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }

  const isFirstTime = participant.lastSeenAt == null;
  const hint = await computeHint(id, isFirstTime, participant.lastSeenAt);

  // DB write is durable — safe to broadcast.
  broadcast(id, "participant_joined", participant);

  const res = NextResponse.json({ participantId: participant.id, catchupHint: hint });
  res.cookies.set(cookieName, participant.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
