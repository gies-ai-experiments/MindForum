import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import {
  assertActiveRoom,
  getActor,
  httpErrorResponse,
  requireJsonContent,
  requireRoomOwner,
} from "@/lib/creator-auth";
import { hardDeleteRoom } from "@/lib/store";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { broadcast } from "@/lib/sse";

export const runtime = "nodejs";

const MAX_NAME_CHARS = 100;
// Mirrors POST /api/room — see that handler for the reasoning behind the bump.
const MAX_SYSTEM_PROMPT_CHARS = 51_200;

/**
 * PATCH: owner / super-admin update name and/or systemPrompt. Either field
 * optional; identical-to-current values are no-ops (no audit row written).
 * Audit metadata captures only `name { from, to }` and the system-prompt
 * length delta — full system-prompt content is not duplicated into the
 * audit log (the row in `rooms` is the source of truth).
 *
 * Refused on archived rooms — restore first.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireJsonContent(req);
    const { id } = await ctx.params;
    const { actor } = await requireRoomOwner(id);
    await assertActiveRoom(id);

    const body = await req.json().catch(() => ({}));
    const wantsName = typeof body.name === "string";
    const wantsPrompt = typeof body.systemPrompt === "string";
    if (!wantsName && !wantsPrompt) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    // Read current values so we can diff for audit and skip no-op updates.
    const current = await query<{ name: string; system_prompt: string }>(
      `SELECT name, system_prompt FROM rooms WHERE id = $1`,
      [id]
    );
    const cur = current.rows[0];
    if (!cur) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const nextName = wantsName
      ? (body.name as string).trim().slice(0, MAX_NAME_CHARS) || cur.name
      : cur.name;
    const nextPrompt = wantsPrompt
      ? (body.systemPrompt as string).trim().slice(0, MAX_SYSTEM_PROMPT_CHARS)
      : cur.system_prompt;

    const nameChanged = nextName !== cur.name;
    const promptChanged = nextPrompt !== cur.system_prompt;
    if (!nameChanged && !promptChanged) {
      return NextResponse.json({ ok: true, name: cur.name, systemPromptLen: cur.system_prompt.length });
    }

    await query(
      `UPDATE rooms SET name = $2, system_prompt = $3 WHERE id = $1`,
      [id, nextName, nextPrompt]
    );

    const metadata: Record<string, unknown> = {};
    if (nameChanged) metadata.name = { from: cur.name, to: nextName };
    if (promptChanged) {
      metadata.systemPromptLen = {
        from: cur.system_prompt.length,
        to: nextPrompt.length,
      };
    }
    await logAudit({ actor, action: "room.update", roomId: id, metadata });

    if (nameChanged) {
      broadcast(id, "room_renamed", { name: nextName });
    }

    return NextResponse.json({ ok: true, name: nextName, systemPromptLen: nextPrompt.length });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

/**
 * DELETE: super-admin hard-delete. Cascades to messages / participants /
 * files / reactions via FK ON DELETE CASCADE on rooms.id. Audit row is
 * written *after* the delete returns so the snapshot metadata reflects the
 * row that just disappeared (the audit_log table has no FK on room_id by
 * design — entries survive hard-delete).
 *
 * Creator path is NOT supported here. Creators archive; only super-admin
 * destroys.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await ctx.params;
    const snap = await hardDeleteRoom(id);
    if (!snap) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const actor = await getActor();
    if (actor) {
      await logAudit({
        actor,
        action: "room.hard_delete",
        roomId: id,
        metadata: snap,
      });
    }
    return NextResponse.json({ ok: true, ...snap });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
