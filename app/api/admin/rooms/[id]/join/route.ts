import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getAdminIdentity } from "@/lib/admin-identity";
import { roomExists, upsertParticipant } from "@/lib/store";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

/** Admin one-click join. Reads the saved facilitator identity, upserts a
 *  participant row, sets the per-room cookie, and 303s to /room/[id]. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  const identity = await getAdminIdentity();
  if (!identity) {
    return NextResponse.json({ error: "identity_required" }, { status: 400 });
  }
  const participant = await upsertParticipant(id, identity.name, identity.email);
  if (!participant) {
    return NextResponse.json({ error: "join_failed" }, { status: 500 });
  }

  // Broadcast so any open dashboard / room tabs see the facilitator arrive.
  broadcast(id, "participant_joined", participant);

  const url = new URL(`/room/${id}`, req.url);
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(`mindforum_pid_${id}`, participant.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  console.info({ adminAction: "join", roomId: id, pid: participant.id, at: new Date().toISOString() });
  return res;
}
