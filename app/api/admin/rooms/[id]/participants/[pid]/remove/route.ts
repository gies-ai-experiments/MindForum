import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { setParticipantRemoved, roomExists } from "@/lib/store";
import { broadcast } from "@/lib/sse";

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
  return NextResponse.json({ ok: true });
}
