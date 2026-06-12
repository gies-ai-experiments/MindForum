import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse, requireRoomOwner } from "@/lib/creator-auth";
import { cancelInvitation } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; invId: string }> }
) {
  try {
    const { id, invId } = await params;
    await requireRoomOwner(id);
    const deleted = await cancelInvitation(invId);
    if (!deleted) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
