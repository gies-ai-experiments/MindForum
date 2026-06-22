import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getActor, httpErrorResponse } from "@/lib/creator-auth";
import { revokeApiKey } from "@/lib/api-key-store";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/** DELETE: revoke any creator's key (super-admin power). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const { id, keyId } = await params;
    const result = await revokeApiKey(keyId, { byAdmin: true, revokedBy: "cr_super_admin" });
    if (!result.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const actor = await getActor();
    if (actor) {
      await logAudit({
        actor,
        action: "api_key.revoke",
        metadata: { keyId, by: "super_admin", targetCreatorId: id },
      });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
