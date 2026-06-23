import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  httpErrorResponse,
  requireJsonContent,
  checkRoomManager,
  HttpError,
} from "@/lib/creator-auth";
import { requireApiKey } from "@/lib/api-key-auth";
import { getRoomMeta, createInvitation, type RoomInvitation } from "@/lib/store";
import { sendInvitationEmail } from "@/lib/email";
import { parseInviteBatch } from "@/lib/invite-batch";
import { checkRate, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

const API_INVITE_DAILY_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

function baseUrlFrom(req: NextRequest): string {
  return (
    process.env.NEXTAUTH_URL ??
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${
      req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000"
    }`
  ).replace(/\/$/, "");
}

/** Invite to a room the key's creator owns. Single or bulk body. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireJsonContent(req);
    const { id } = await params;
    const { creator, keyId } = await requireApiKey(req);

    // Ownership: missing room OR not owned → 404 (checkRoomManager throws 404 for
    // a non-super-admin cross-owner; API creators are never super-admin).
    const room = await getRoomMeta(id);
    if (!room) throw new HttpError(404, "not_found");
    await checkRoomManager(creator, room);

    const dailyRate = checkRate("api-invite-daily", keyId, API_INVITE_DAILY_LIMIT, DAY_MS);
    if (!dailyRate.allowed) return rateLimited(dailyRate.retryAfterSeconds);

    const body = await req.json();
    const baseUrl = baseUrlFrom(req);

    // Bulk path: { invites: [{ inviteeEmail, inviteeName }, ...] }
    if (Array.isArray((body as { invites?: unknown }).invites)) {
      const batch = parseInviteBatch(body);
      const created: RoomInvitation[] = [];
      let skipped = 0;
      for (const entry of batch) {
        const result = await createInvitation({
          roomId: id,
          inviterId: creator.id,
          inviteeEmail: entry.inviteeEmail,
          inviteeName: entry.inviteeName,
        });
        if (result.ok) created.push(result.invitation);
        else if (result.error === "room_not_found")
          return NextResponse.json({ error: "not_found" }, { status: 404 });
        else skipped++; // already_invited
      }
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
          if (s.status === "fulfilled" && !s.value.ok && s.value.error !== "not_configured") {
            const msg = `[v1 invitations] bulk email send failed: ${s.value.error}`;
            console.error(msg);
            Sentry.captureMessage(msg, "warning");
          }
        }
      });
      return NextResponse.json({ created, skipped }, { status: 201 });
    }

    // Single path
    const { inviteeEmail, inviteeName } = body;
    if (!inviteeEmail || typeof inviteeEmail !== "string" || !inviteeEmail.includes("@")) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (!inviteeName || typeof inviteeName !== "string" || !inviteeName.trim()) {
      return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    }
    const result = await createInvitation({
      roomId: id,
      inviterId: creator.id,
      inviteeEmail: inviteeEmail.trim(),
      inviteeName: inviteeName.trim(),
    });
    if (!result.ok) {
      const status = result.error === "room_not_found" ? 404 : 409;
      const error = result.error === "room_not_found" ? "not_found" : result.error;
      return NextResponse.json({ error }, { status });
    }
    const emailResult = await sendInvitationEmail({
      inviteeEmail: result.invitation.inviteeEmail,
      inviteeName: result.invitation.inviteeName,
      roomName: result.invitation.roomName,
      inviterName: result.invitation.inviterName,
      acceptUrl: `${baseUrl}/dashboard`,
    });
    if (!emailResult.ok && emailResult.error !== "not_configured") {
      const msg = `[v1 invitations] email send failed for ${result.invitation.id}: ${emailResult.error}`;
      console.error(msg);
      Sentry.captureMessage(msg, "warning");
    }
    return NextResponse.json(result.invitation, { status: 201 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
