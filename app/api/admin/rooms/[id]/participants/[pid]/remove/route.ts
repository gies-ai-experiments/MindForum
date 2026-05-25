import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getActor } from "@/lib/creator-auth";
import { setParticipantRemoved, roomExists } from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, pid } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  await setParticipantRemoved(id, pid);
  broadcast(id, "participant_removed", { participantId: pid });
  console.info({ adminAction: "remove", roomId: id, pid, at: new Date().toISOString() });

  const actor = await getActor();
  if (actor) {
    await logAudit({
      actor,
      action: "participant.remove",
      roomId: id,
      metadata: { participantId: pid },
    });
  }

  return NextResponse.json({ ok: true });
}
