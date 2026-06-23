import { NextRequest, NextResponse } from "next/server";
import { requireRoomOwner, httpErrorResponse } from "@/lib/creator-auth";
import { revokeCoAdmin, coAdminEmails } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; creatorId: string }> },
) {
  try {
    const { id, creatorId } = await ctx.params;
    const { actor } = await requireRoomOwner(id);
    await revokeCoAdmin(id, creatorId);
    await logAudit({ actor, action: "room_admin.revoke", roomId: id, metadata: { creatorId } });
    broadcast(id, "co_admin_changed", { coAdminEmails: await coAdminEmails(id) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
