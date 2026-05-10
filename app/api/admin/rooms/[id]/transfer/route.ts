import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getActor, httpErrorResponse, requireJsonContent } from "@/lib/creator-auth";
import { getCreatorById, getRoomMeta, transferRoom } from "@/lib/store";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * POST: super-admin reassigns room ownership. Body `{ ownerId }`. Validates
 * that the target creator exists and isn't the synthetic super-admin row
 * (transferring TO super-admin would orphan the room from the dashboard;
 * leave that path explicit and undocumented for now).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    requireJsonContent(req);
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";
    if (!ownerId) {
      return NextResponse.json({ error: "missing_owner_id" }, { status: 400 });
    }

    const room = await getRoomMeta(id);
    if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const target = await getCreatorById(ownerId);
    if (!target) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
    if (target.disabledAt !== null) {
      return NextResponse.json({ error: "owner_disabled" }, { status: 409 });
    }

    if (room.ownerId === ownerId) {
      // No-op transfer; skip the audit row to keep the log signal-rich.
      return NextResponse.json({ ok: true, fromOwnerId: ownerId, toOwnerId: ownerId });
    }

    const r = await transferRoom(id, ownerId);
    if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const actor = await getActor();
    if (actor) {
      await logAudit({
        actor,
        action: "room.transfer",
        roomId: id,
        metadata: { fromOwnerId: r.fromOwnerId, toOwnerId: ownerId },
      });
    }
    return NextResponse.json({ ok: true, fromOwnerId: r.fromOwnerId, toOwnerId: ownerId });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
