import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { setParticipantMuted, roomExists } from "@/lib/store";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, pid } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const muted = body.muted === true;

  await setParticipantMuted(id, pid, muted);
  broadcast(id, "participant_muted", { participantId: pid, muted });
  console.info({ adminAction: "mute", roomId: id, pid, muted, at: new Date().toISOString() });
  return NextResponse.json({ ok: true, muted });
}
