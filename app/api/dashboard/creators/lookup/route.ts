import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse } from "@/lib/creator-auth";
import { lookupInviteCandidates } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireCreator();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const results = await lookupInviteCandidates(q, actor.id, actor.email);
    return NextResponse.json(results);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
