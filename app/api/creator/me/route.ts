import { NextResponse } from "next/server";
import { getCreator } from "@/lib/creator-auth";

export const runtime = "nodejs";

/**
 * GET: return the authenticated creator's profile. 401 if no cookie or the
 * creator is disabled / token rotated. Used by the dashboard header strip.
 */
export async function GET() {
  const c = await getCreator();
  if (!c) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    id: c.id,
    email: c.email,
    displayName: c.displayName,
    isSuperAdmin: c.isSuperAdmin,
  });
}
