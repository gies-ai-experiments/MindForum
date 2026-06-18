import { NextRequest, NextResponse } from "next/server";
import {
  deleteRoomFileWithSystemNote,
  getParticipant,
  getRoomFileById,
  getRoomMeta,
} from "@/lib/store";
import { query } from "@/lib/db";
import { broadcast } from "@/lib/sse";
import {
  assertActiveOrOwnerOnArchive,
  getActor,
  httpErrorResponse,
} from "@/lib/creator-auth";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// Returns the full extracted text for a single file, scoped to one room.
// This is the *only* place clients should pull `extractedText` from — the
// room snapshot deliberately strips it (see lib/store.ts snapshot()) so the
// initial SSE payload stays small. Loading content on demand here keeps the
// snapshot lean even when a room has many large KB files.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await ctx.params;
  // Archived rooms: owner / super-admin can still preview file content
  // (useful for reviewing history before restore); other participants get 410.
  let archived: boolean;
  let isOwner: boolean;
  try {
    ({ archived, isOwner } = await assertActiveOrOwnerOnArchive(id));
  } catch (err) {
    return httpErrorResponse(err);
  }

  // Active rooms still require participant membership. Archived rooms reached
  // here have already been gated to owner/super-admin, who don't need to be
  // joined as participants to review history (per soft-delete matrix).
  if (!(archived && isOwner)) {
    const pid = req.cookies.get(`mindforum_pid_${id}`)?.value;
    const participant = pid ? await getParticipant(id, pid) : null;
    if (!participant) return NextResponse.json({ error: "not_joined" }, { status: 401 });
  }

  const { rows } = await query<{
    id: string;
    name: string;
    mime: string;
    size_bytes: number;
    uploaded_by_id: string;
    uploaded_at: Date;
    extracted_text: string;
    source_type: "uploaded" | "github_repo" | "web_url";
    source_url: string | null;
    source_meta: Record<string, unknown> | null;
    uploader_name: string | null;
    uploader_email: string | null;
  }>(
    `SELECT rf.id, rf.name, rf.mime, rf.size_bytes, rf.uploaded_by_id, rf.uploaded_at,
            rf.extracted_text, rf.source_type, rf.source_url, rf.source_meta,
            p.name AS uploader_name, p.email AS uploader_email
     FROM room_files rf
     LEFT JOIN participants p
       ON p.id = rf.uploaded_by_id AND p.room_id = rf.room_id
     WHERE rf.room_id = $1 AND rf.id = $2`,
    [id, fileId]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "file_not_found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at.getTime(),
    uploadedById: row.uploaded_by_id,
    uploaderName: row.uploader_name,
    uploaderEmail: row.uploader_email,
    extractedText: row.extracted_text,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    sourceMeta: row.source_meta,
  });
}

/**
 * DELETE: remove a file from the room.
 *
 * Two-branch auth (codex-reviewed plan):
 *  - Owner / super-admin (via creator cookie or NextAuth/Entra session) can
 *    delete ANY file in a room they own. Super-admin bypasses ownership.
 *  - Otherwise, a joined participant can delete a file they uploaded
 *    themselves (`file.uploaded_by_id === participant.id`). Files attached via
 *    the owner dashboard use `creator:<actor.id>` and can't be matched by a
 *    participant cookie, so owner-attached files stay owner-only deletable.
 *  - A participant who joined but did not upload the file gets 403
 *    `not_your_file` (they're already a room member, so no existence leak).
 *  - A non-joined requester gets 401 `not_joined` regardless of creator
 *    status — preserves the existing 404-not-403 cross-owner hiding behavior.
 *
 * The delete + the explanatory kind:"system" chat note are written in a single
 * transaction (deleteRoomFileWithSystemNote) so a 204 guarantees BOTH the file
 * row is gone AND the chat note is persisted. Audit log stays outside the tx
 * (best-effort record, not a gate). Refuses on archived rooms (per the
 * soft-delete matrix: edits to archived rooms require restore first).
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await ctx.params;
    const room = await getRoomMeta(id);
    if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (room.archivedAt !== null) {
      return NextResponse.json({ error: "archived" }, { status: 410 });
    }

    // Resolve actor for the two-branch decision. Owner/super-admin path does
    // not require a participant cookie; uploader path does.
    const actor = await getActor();
    const isOwnerActor = !!actor && (actor.isSuperAdmin || room.ownerId === actor.id);

    let author: { id: string; name: string };
    let deleterRole: "owner" | "super_admin" | "uploader";
    let auditActor: { id: string; email: string };
    let fileName: string;

    if (isOwnerActor && actor) {
      // Owner / super-admin: can delete any file. Single lookup for the name
      // (the note text); the tx re-SELECTs under FOR UPDATE for TOCTOU safety.
      const file = await getRoomFileById(id, fileId);
      if (!file) return NextResponse.json({ error: "file_not_found" }, { status: 404 });
      author = { id: actor.id, name: actor.displayName };
      deleterRole = actor.isSuperAdmin ? "super_admin" : "owner";
      auditActor = { id: actor.id, email: actor.email };
      fileName = file.name;
    } else {
      // Uploader path: must be a joined participant deleting their own upload.
      // A non-joined requester (including a cross-owner creator) gets 401
      // not_joined here, preserving the existing cross-owner hiding behavior.
      const auth = await requireRoomParticipant(req, id);
      if (!auth.ok) return auth.response;
      const participant = auth.participant;

      const file = await getRoomFileById(id, fileId);
      if (!file) return NextResponse.json({ error: "file_not_found" }, { status: 404 });
      if (file.uploadedById !== participant.id) {
        // Participant is already a room member — revealing "not your file"
        // leaks nothing about room existence.
        return NextResponse.json({ error: "not_your_file" }, { status: 403 });
      }
      author = { id: participant.id, name: participant.name };
      deleterRole = "uploader";
      auditActor = { id: participant.id, email: participant.email };
      fileName = file.name;
    }

    const note = `\`${author.name}\` removed "${fileName}" from the room. Future @ai replies won't reference it.`;
    const result = await deleteRoomFileWithSystemNote(id, fileId, author, note);
    if (!result) {
      // File vanished between our auth-phase lookup and the tx FOR UPDATE
      // (e.g. another concurrent delete). Treat as not-found.
      return NextResponse.json({ error: "file_not_found" }, { status: 404 });
    }
    const { file, message } = result;

    await logAudit({
      actor: auditActor,
      action: "file.delete",
      roomId: id,
      metadata: {
        fileId: file.id,
        fileName: file.name,
        sizeBytes: file.sizeBytes,
        deleterRole,
      },
    });
    broadcast(id, "file_removed", { id: fileId });
    broadcast(id, "message_added", message);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
