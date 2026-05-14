import { NextRequest, NextResponse } from "next/server";
import { getParticipant, type Participant } from "./store";

export { isAdmin } from "./admin-auth";

export type AuthResult =
  | { ok: true; participant: Participant }
  | { ok: false; response: NextResponse };

/**
 * Resolves the room participant from the `mindforum_pid_<roomId>` cookie.
 * On failure returns a 401 NextResponse so callers can `return auth.response`.
 *
 * Mirrors the inline pattern in /message and /upload routes — extracted so the
 * four poll routes (and any future room-scoped routes) don't duplicate it.
 */
export async function requireRoomParticipant(
  req: NextRequest,
  roomId: string,
): Promise<AuthResult> {
  const pid = req.cookies.get(`mindforum_pid_${roomId}`)?.value;
  const participant = pid ? await getParticipant(roomId, pid) : null;
  if (!participant || participant.removedAt != null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not_joined" }, { status: 401 }),
    };
  }
  return { ok: true, participant };
}
