import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getActor, httpErrorResponse, requireJsonContent } from "@/lib/creator-auth";
import {
  deleteCreator,
  setCreatorDisabled,
  updateCreatorDisplayName,
  getCreatorById,
} from "@/lib/store";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_DISPLAY_NAME = 80;

/**
 * PATCH: update displayName and/or disabled flag. Either field optional;
 * present-but-unchanged is a no-op (no audit row written for empty diffs).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    requireJsonContent(req);
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const actor = await getActor();

    const target = await getCreatorById(id);
    if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (typeof body.displayName === "string") {
      const next = body.displayName.trim().slice(0, MAX_DISPLAY_NAME);
      if (!next) {
        return NextResponse.json({ error: "missing_display_name" }, { status: 400 });
      }
      if (next !== target.displayName) {
        const r = await updateCreatorDisplayName(id, next);
        if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
        if (actor) {
          await logAudit({
            actor,
            action: "allowlist.update",
            metadata: { displayName: { from: r.from, to: next } },
          });
        }
      }
    }

    if (typeof body.disabled === "boolean") {
      const wasDisabled = target.disabledAt !== null;
      if (body.disabled !== wasDisabled) {
        const r = await setCreatorDisabled(id, body.disabled);
        if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
        if (actor) {
          await logAudit({
            actor,
            action: body.disabled ? "allowlist.disable" : "allowlist.enable",
            metadata: { creatorEmail: target.email },
          });
        }
      }
    }

    const updated = await getCreatorById(id);
    return NextResponse.json({ creator: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

/**
 * DELETE: remove from allowlist. Refused if the creator owns rooms — UX
 * prompts the operator to disable or transfer first. Audit row is written
 * before the delete so the creator's email is captured.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const actor = await getActor();
  const result = await deleteCreator(id);
  if (!result.ok) {
    if (result.error === "owns_rooms") {
      return NextResponse.json(
        { error: result.error, roomCount: result.roomCount },
        { status: 409 }
      );
    }
    if (result.error === "not_found") {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (actor) {
    await logAudit({
      actor,
      action: "allowlist.delete",
      metadata: { creatorEmail: result.email },
    });
  }
  return new NextResponse(null, { status: 204 });
}
