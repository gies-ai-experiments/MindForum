import { NextRequest, NextResponse } from "next/server";
import {
  assertActiveRoom,
  httpErrorResponse,
  requireJsonContent,
  requireRoomManager,
  requireRoomOwner,
} from "@/lib/creator-auth";
import { hardDeleteRoom, setMentionRemindersEnabled, setWebSearchEnabled } from "@/lib/store";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { broadcast } from "@/lib/sse";
import { MAX_SYSTEM_PROMPT_CHARS } from "@/lib/limits";

export const runtime = "nodejs";

const MAX_NAME_CHARS = 100;

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
    const { actor } = await requireRoomManager(id);
    await assertActiveRoom(id);

    const body = await req.json().catch(() => ({}));
    const wantsName = typeof body.name === "string";
    const wantsPrompt = typeof body.systemPrompt === "string";
    const wantsReminders = typeof body.mentionRemindersEnabled === "boolean";
    const wantsWebSearch = typeof body.webSearchEnabled === "boolean";
    if (!wantsName && !wantsPrompt && !wantsReminders && !wantsWebSearch) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    // Read current values so we can diff for audit and skip no-op updates.
    const current = await query<{
      name: string;
      system_prompt: string;
      mention_reminders_enabled: boolean;
      web_search_enabled: boolean;
    }>(
      `SELECT name, system_prompt, mention_reminders_enabled, web_search_enabled FROM rooms WHERE id = $1`,
      [id]
    );
    const cur = current.rows[0];
    if (!cur) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const nextName = wantsName
      ? (body.name as string).trim().slice(0, MAX_NAME_CHARS) || cur.name
      : cur.name;
    const trimmedPrompt = wantsPrompt
      ? (body.systemPrompt as string).trim()
      : cur.system_prompt;
    // Enforce the cap only when the prompt actually changes, so rooms created
    // under the old 51,200 limit can still take name-only edits (the editor
    // re-sends the unchanged long prompt) without being rejected.
    if (
      wantsPrompt &&
      trimmedPrompt !== cur.system_prompt &&
      trimmedPrompt.length > MAX_SYSTEM_PROMPT_CHARS
    ) {
      return NextResponse.json(
        {
          error: "system_prompt_too_long",
          max: MAX_SYSTEM_PROMPT_CHARS,
          got: trimmedPrompt.length,
        },
        { status: 400 }
      );
    }
    const nextPrompt = trimmedPrompt;

    const nextReminders = wantsReminders
      ? (body.mentionRemindersEnabled as boolean)
      : cur.mention_reminders_enabled;

    const nextWebSearch = wantsWebSearch
      ? (body.webSearchEnabled as boolean)
      : cur.web_search_enabled;

    const nameChanged = nextName !== cur.name;
    const promptChanged = nextPrompt !== cur.system_prompt;
    const remindersChanged = nextReminders !== cur.mention_reminders_enabled;
    const webSearchChanged = nextWebSearch !== cur.web_search_enabled;
    if (!nameChanged && !promptChanged && !remindersChanged && !webSearchChanged) {
      return NextResponse.json({
        ok: true,
        name: cur.name,
        systemPromptLen: cur.system_prompt.length,
        mentionRemindersEnabled: cur.mention_reminders_enabled,
        webSearchEnabled: cur.web_search_enabled,
      });
    }

    if (nameChanged || promptChanged) {
      await query(
        `UPDATE rooms SET name = $2, system_prompt = $3 WHERE id = $1`,
        [id, nextName, nextPrompt]
      );
    }
    // Encapsulated so disabling also cancels the room's pending reminders.
    if (remindersChanged) {
      await setMentionRemindersEnabled(id, nextReminders);
    }
    if (webSearchChanged) {
      await setWebSearchEnabled(id, nextWebSearch);
    }

    const metadata: Record<string, unknown> = {};
    if (nameChanged) metadata.name = { from: cur.name, to: nextName };
    if (promptChanged) {
      metadata.systemPromptLen = {
        from: cur.system_prompt.length,
        to: nextPrompt.length,
      };
    }
    if (remindersChanged) {
      metadata.mentionRemindersEnabled = {
        from: cur.mention_reminders_enabled,
        to: nextReminders,
      };
    }
    if (webSearchChanged) {
      metadata.webSearchEnabled = {
        from: cur.web_search_enabled,
        to: nextWebSearch,
      };
    }
    await logAudit({ actor, action: "room.update", roomId: id, metadata });

    if (nameChanged) {
      broadcast(id, "room_renamed", { name: nextName });
    }

    return NextResponse.json({
      ok: true,
      name: nextName,
      systemPromptLen: nextPrompt.length,
      mentionRemindersEnabled: nextReminders,
      webSearchEnabled: nextWebSearch,
    });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

/**
 * DELETE: hard-delete by the room owner or super-admin (requireRoomOwner).
 * Refused on active rooms (`409 not_archived`) — a room must be archived first;
 * archive is the recoverable staging step, enforced atomically inside
 * `hardDeleteRoom` (see lib/store.ts). Audit row is written after the delete
 * returns so the snapshot metadata reflects the row that just disappeared.
 * Co-admins archive; only the owner (or super-admin) destroys.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    // Owner of their own room, or super-admin. 401 if no actor; 404 if a
    // different creator's room (existence not leaked). Co-admins do NOT pass —
    // hard-delete is owner-only; they archive instead.
    const { actor } = await requireRoomOwner(id);
    const result = await hardDeleteRoom(id);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.reason }, { status });
    }
    const snap = {
      slug: result.slug,
      name: result.name,
      ownerId: result.ownerId,
      messageCount: result.messageCount,
      fileCount: result.fileCount,
    };
    await logAudit({ actor, action: "room.hard_delete", roomId: id, metadata: snap });
    return NextResponse.json({ ok: true, ...snap });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
