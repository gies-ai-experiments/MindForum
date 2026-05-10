import { NextRequest, NextResponse } from "next/server";
import { httpErrorResponse, requireRoomOwner } from "@/lib/creator-auth";
import { restoreRoom } from "@/lib/store";
import { logAudit } from "@/lib/audit";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

/** POST: restore an archived room. Idempotent. Owner-or-super-admin only. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { actor, room } = await requireRoomOwner(id);
    const wasArchived = room.archivedAt !== null;
    const ok = await restoreRoom(id);
    if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (wasArchived) {
      await logAudit({ actor, action: "room.restore", roomId: id });
      broadcast(id, "room_restored", { archived: false });
    }
    return NextResponse.json({ ok: true, archived: false });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
