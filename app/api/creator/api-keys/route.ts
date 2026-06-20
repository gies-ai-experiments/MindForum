import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse, requireJsonContent } from "@/lib/creator-auth";
import { createApiKey, listApiKeysByCreator } from "@/lib/api-key-store";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_KEY_NAME = 80;

/** GET: list the signed-in creator's API keys (metadata only). */
export async function GET() {
  try {
    const creator = await requireCreator();
    const keys = await listApiKeysByCreator(creator.id);
    return NextResponse.json({ keys });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

/** POST { name }: mint a key. Returns the plaintext exactly once. */
export async function POST(req: NextRequest) {
  try {
    requireJsonContent(req);
    const creator = await requireCreator();
    const body = await req.json().catch(() => ({}));
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, MAX_KEY_NAME)
        : "";
    if (!name) {
      return NextResponse.json({ error: "missing_name" }, { status: 400 });
    }
    const { apiKey, plaintextKey } = await createApiKey({ creatorId: creator.id, name });
    await logAudit({
      actor: creator,
      action: "api_key.create",
      metadata: { keyId: apiKey.id, name: apiKey.name },
    });
    // One-time reveal. The client discards plaintextKey after the user copies it.
    return NextResponse.json({ apiKey, plaintextKey }, { status: 201 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
