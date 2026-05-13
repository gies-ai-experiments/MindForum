import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import {
  ADMIN_IDENTITY_COOKIE,
  adminIdentityCookieOptions,
  getAdminIdentity,
} from "@/lib/admin-identity";

export const runtime = "nodejs";

/** Return the current facilitator identity (or null) so the dashboard can
 *  decide whether to prompt for it before the first Join. */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ identity: await getAdminIdentity() });
}

/** Set the facilitator identity cookie. */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
  if (!name || !email) {
    return NextResponse.json({ error: "name_and_email_required" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    ADMIN_IDENTITY_COOKIE,
    JSON.stringify({ name, email }),
    adminIdentityCookieOptions(),
  );
  return res;
}
