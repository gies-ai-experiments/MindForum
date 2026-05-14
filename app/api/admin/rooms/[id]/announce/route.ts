import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { postSystemAnnouncement, roomExists } from "@/lib/store";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

/** Post a kind:"system" message attributed to "Facilitator".
 *  Admin bypass: works on closed rooms too. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "empty" }, { status: 400 });

  const msg = await postSystemAnnouncement(id, content);
  broadcast(id, "message_added", msg);
  console.info({ adminAction: "announce", roomId: id, msgId: msg.id, at: new Date().toISOString() });
  return NextResponse.json({ ok: true, id: msg.id });
}
