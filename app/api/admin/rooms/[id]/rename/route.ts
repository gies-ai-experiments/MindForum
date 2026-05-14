import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { renameRoom, roomExists } from "@/lib/store";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!(await roomExists(id))) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

  await renameRoom(id, name);
  broadcast(id, "room_renamed", { roomId: id, name });
  console.info({ adminAction: "rename", roomId: id, name, at: new Date().toISOString() });
  return NextResponse.json({ ok: true, name });
}
