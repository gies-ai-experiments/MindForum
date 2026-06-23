import { NextRequest, NextResponse } from "next/server";
import {
  requireRoomOwner,
  provisionCreator,
  httpErrorResponse,
  requireJsonContent,
} from "@/lib/creator-auth";
import {
  getParticipant,
  getCreatorByEmail,
  grantCoAdmin,
  listCoAdmins,
  coAdminEmails,
} from "@/lib/store";
import { broadcast } from "@/lib/sse";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requireRoomOwner(id);
    return NextResponse.json(await listCoAdmins(id));
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireJsonContent(req);
    const { id } = await ctx.params;
    const { actor, room } = await requireRoomOwner(id);
    const body = await req.json().catch(() => ({}));
    const participantId = typeof body.participantId === "string" ? body.participantId : "";
    if (!participantId) {
      return NextResponse.json({ error: "participant_required" }, { status: 400 });
    }

    const participant = await getParticipant(id, participantId);
    if (!participant || participant.removedAt != null) {
      return NextResponse.json({ error: "participant_not_found" }, { status: 404 });
    }

    // Find-or-create the creator by email; auto-provisioned creators sign in via
    // Entra SSO with that email, so the plaintext token is discarded.
    let creator = await getCreatorByEmail(participant.email);
    if (!creator) {
      const prov = await provisionCreator({
        email: participant.email,
        displayName: participant.name,
        createdBy: actor.id,
      });
      if (!prov.ok) {
        // Race: another path created it between the lookup and now — re-fetch.
        creator = await getCreatorByEmail(participant.email);
        if (!creator) {
          return NextResponse.json({ error: "provision_failed" }, { status: 500 });
        }
      } else {
        creator = prov.creator;
      }
    }

    if (creator.id === room.ownerId) {
      return NextResponse.json({ error: "cant_coadmin_owner" }, { status: 400 });
    }

    await grantCoAdmin(id, creator.id, actor.id);
    await logAudit({
      actor,
      action: "room_admin.grant",
      roomId: id,
      metadata: { creatorId: creator.id, email: creator.email, name: creator.displayName },
    });
    broadcast(id, "co_admin_changed", { coAdminEmails: await coAdminEmails(id) });
    return NextResponse.json({
      ok: true,
      creator: { id: creator.id, email: creator.email, displayName: creator.displayName },
    });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
