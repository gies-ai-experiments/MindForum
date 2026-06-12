import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse } from "@/lib/creator-auth";
import { listPendingInvitationsByEmail } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const creator = await requireCreator();
    const invitations = await listPendingInvitationsByEmail(creator.email);
    return NextResponse.json(invitations);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
