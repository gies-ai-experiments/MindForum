import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireCreator, httpErrorResponse, requireRoomOwner, requireJsonContent } from "@/lib/creator-auth";
import { createInvitation, listInvitationsByRoom } from "@/lib/store";
import { sendInvitationEmail } from "@/lib/email";

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

    // Best-effort invitation email — never block invite creation on email.
    const baseUrl = (
      process.env.NEXTAUTH_URL ??
      `${req.headers.get("x-forwarded-proto") ?? "https"}://${
        req.headers.get("x-forwarded-host") ??
        req.headers.get("host") ??
        "localhost:3000"
      }`
    ).replace(/\/$/, "");

    const emailResult = await sendInvitationEmail({
      inviteeEmail: result.invitation.inviteeEmail,
      inviteeName: result.invitation.inviteeName,
      roomName: result.invitation.roomName,
      inviterName: result.invitation.inviterName,
      acceptUrl: `${baseUrl}/dashboard`,
    });
    if (!emailResult.ok && emailResult.error !== "not_configured") {
      const msg = `[invitations] email send failed for ${result.invitation.id}: ${emailResult.error}`;
      console.error(msg);
      Sentry.captureMessage(msg, "warning");
    }

    return NextResponse.json(result.invitation, { status: 201 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
