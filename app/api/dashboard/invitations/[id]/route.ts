import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse, requireJsonContent } from "@/lib/creator-auth";
import { updateInvitationStatus } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireJsonContent(req);
    const { id } = await params;
    const creator = await requireCreator();
    const body = await req.json();
    const action = body.action;

    if (action !== "accept" && action !== "decline") {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }

    const status = action === "accept" ? "accepted" : "declined";
    const result = await updateInvitationStatus(id, creator.email, status);
    if (!result) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
