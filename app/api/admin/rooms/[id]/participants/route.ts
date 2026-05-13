import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { listParticipantsForAdmin } from "@/lib/store";

export const runtime = "nodejs";

/** Per-room participant list for the admin dashboard's expanded row.
 *  Pass ?includeRemoved=1 to see kicked participants (for undo). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const includeRemoved =
    new URL(req.url).searchParams.get("includeRemoved") === "1";
  const participants = await listParticipantsForAdmin(id, { includeRemoved });
  return NextResponse.json({ participants });
}
