import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse } from "@/lib/creator-auth";
import { revokeApiKey } from "@/lib/api-key-store";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/** DELETE: revoke a key the signed-in creator owns. 404 if not theirs. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const creator = await requireCreator();
    const { keyId } = await params;
    const result = await revokeApiKey(keyId, { creatorId: creator.id, revokedBy: creator.id });
    if (!result.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await logAudit({
      actor: creator,
      action: "api_key.revoke",
      metadata: { keyId, by: "self" },
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
