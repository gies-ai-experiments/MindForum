import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { closeRoom, roomExists } from "@/lib/store";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  await closeRoom(id);
  const at = Date.now();
  broadcast(id, "room_closed", { roomId: id, closedAt: at });
  console.info({ adminAction: "close", roomId: id, at: new Date(at).toISOString() });
  return NextResponse.json({ ok: true, closedAt: at });
}
