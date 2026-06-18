import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireCreator, httpErrorResponse, requireRoomOwner, requireJsonContent } from "@/lib/creator-auth";
import { createInvitation, listInvitationsByRoom, type RoomInvitation } from "@/lib/store";
import { sendInvitationEmail } from "@/lib/email";
import { parseInviteBatch } from "@/lib/invite-batch";

function baseUrlFrom(req: NextRequest): string {
  return (
    process.env.NEXTAUTH_URL ??
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      "localhost:3000"
    }`
  ).replace(/\/$/, "");
}

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

    // Bulk path: { invites: [{ inviteeEmail, inviteeName }, ...] }
    if (Array.isArray((body as { invites?: unknown }).invites)) {
      const batch = parseInviteBatch(body);
      const baseUrl = baseUrlFrom(req);

      const created: RoomInvitation[] = [];
      let skipped = 0;
      for (const entry of batch) {
        const result = await createInvitation({
          roomId: id,
          inviterId: actor.id,
          inviteeEmail: entry.inviteeEmail,
          inviteeName: entry.inviteeName,
        });
        if (result.ok) {
          created.push(result.invitation);
        } else if (result.error === "room_not_found") {
          return NextResponse.json({ error: "room_not_found" }, { status: 404 });
        } else {
          skipped++; // already_invited
        }
      }

      // Fire emails best-effort WITHOUT awaiting — never gate the response.
      void Promise.allSettled(
        created.map((inv) =>
          sendInvitationEmail({
            inviteeEmail: inv.inviteeEmail,
            inviteeName: inv.inviteeName,
            roomName: inv.roomName,
            inviterName: inv.inviterName,
            acceptUrl: `${baseUrl}/dashboard`,
          })
        )
      ).then((settled) => {
        for (const s of settled) {
          if (
            s.status === "fulfilled" &&
            !s.value.ok &&
            s.value.error !== "not_configured"
          ) {
            const msg = `[invitations] bulk email send failed: ${s.value.error}`;
            console.error(msg);
            Sentry.captureMessage(msg, "warning");
          }
        }
      });

      return NextResponse.json({ created, skipped }, { status: 201 });
    }

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
    const baseUrl = baseUrlFrom(req);

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
