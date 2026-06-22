import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { httpErrorResponse } from "@/lib/creator-auth";
import { listApiKeysByCreator } from "@/lib/api-key-store";

export const runtime = "nodejs";

/** GET: list a given creator's API keys (super-admin only). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const keys = await listApiKeysByCreator(id);
    return NextResponse.json({ keys });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
