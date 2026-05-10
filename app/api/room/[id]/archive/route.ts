import { NextRequest, NextResponse } from "next/server";
import { httpErrorResponse, requireRoomOwner } from "@/lib/creator-auth";
import { archiveRoom } from "@/lib/store";
import { logAudit } from "@/lib/audit";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

/**
 * POST: archive a room. Idempotent — archiving an already-archived room
 * succeeds without touching `archived_at`. Owner-or-super-admin only.
 *
 * Broadcasts `room_archived` so live SSE clients can swap to the read-only
 * frame without a full reload.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { actor, room } = await requireRoomOwner(id);
    const wasArchived = room.archivedAt !== null;
    const ok = await archiveRoom(id);
    if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!wasArchived) {
      await logAudit({ actor, action: "room.archive", roomId: id });
      broadcast(id, "room_archived", { archived: true });
    }
    return NextResponse.json({ ok: true, archived: true });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
