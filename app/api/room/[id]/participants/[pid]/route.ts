import { NextRequest, NextResponse } from "next/server";
import { httpErrorResponse, requireRoomOwner } from "@/lib/creator-auth";
import { removeParticipant } from "@/lib/store";
import { logAudit } from "@/lib/audit";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

/**
 * DELETE: kick a participant from the room. Owner / super-admin only.
 * Refused on archived rooms (would be a write to a frozen room).
 *
 * Messages and reactions authored by the kicked participant are preserved
 * by design — the participants table holds the live identity, not the
 * conversation history. v1 has no blocklist: the participant can rejoin if
 * they still have the link. (Adding a blocklist is in the v2 deferred list.)
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> }
) {
  try {
    const { id, pid } = await ctx.params;
    const { actor, room } = await requireRoomOwner(id);
    if (room.archivedAt !== null) {
      return NextResponse.json({ error: "archived" }, { status: 410 });
    }
    const snap = await removeParticipant(id, pid);
    if (!snap) {
      return NextResponse.json({ error: "participant_not_found" }, { status: 404 });
    }
    await logAudit({
      actor,
      action: "participant.kick",
      roomId: id,
      metadata: {
        participantEmail: snap.email,
        participantName: snap.name,
        joinedAt: snap.joinedAt,
      },
    });
    broadcast(id, "participant_removed", { id: pid });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
