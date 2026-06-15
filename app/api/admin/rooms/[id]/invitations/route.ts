import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse, requireRoomOwner, requireJsonContent } from "@/lib/creator-auth";
import { createInvitation, listInvitationsByRoom } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireRoomOwner(id);
    const invitations = await listInvitationsByRoom(id);
    return NextResponse.json(invitations);
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireJsonContent(req);
    const { id } = await params;
    const { actor } = await requireRoomOwner(id);
    const body = await req.json();
    const { inviteeEmail, inviteeName } = body;

    if (!inviteeEmail || typeof inviteeEmail !== "string" || !inviteeEmail.includes("@")) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (!inviteeName || typeof inviteeName !== "string" || !inviteeName.trim()) {
      return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    }

    const result = await createInvitation({
      roomId: id,
      inviterId: actor.id,
      inviteeEmail: inviteeEmail.trim(),
      inviteeName: inviteeName.trim(),
    });

    if (!result.ok) {
      const status = result.error === "room_not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result.invitation, { status: 201 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
