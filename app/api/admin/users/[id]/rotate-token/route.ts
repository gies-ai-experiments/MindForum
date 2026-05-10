import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getActor, regenerateCreatorToken } from "@/lib/creator-auth";
import { getCreatorById } from "@/lib/store";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * POST: generate a fresh token for the creator. Old cookie stops working on
 * the next request. Plaintext is returned exactly once. The audit row never
 * contains the token (only the creator email).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const target = await getCreatorById(id);
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await regenerateCreatorToken(id);
  if (!result.ok) {
    if (result.error === "is_super_admin") {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  const actor = await getActor();
  if (actor) {
    await logAudit({
      actor,
      action: "allowlist.rotate_token",
      metadata: { creatorEmail: target.email },
    });
  }

  return NextResponse.json({ plaintextToken: result.plaintextToken });
}
