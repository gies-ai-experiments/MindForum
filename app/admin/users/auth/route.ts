import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE_S, adminToken, tokenMatches } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Mirrors /admin/rooms/auth — both surfaces share the ADMIN_TOKEN cookie.
// Behind nginx, req.url uses the internal listening address, so build
// redirects from x-forwarded-* headers (see vps-deployment notes).
function publicUrl(req: NextRequest, path: string): URL {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    new URL(req.url).host;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  return new URL(path, `${proto}://${host}`);
}

function setCookieAndRedirect(req: NextRequest, token: string): NextResponse {
  const res = NextResponse.redirect(publicUrl(req, "/admin/users"));
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE_S,
  });
  return res;
}

function unauthorized(req: NextRequest): NextResponse {
  const url = publicUrl(req, "/admin/users");
  url.searchParams.set("err", "bad_token");
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  if (!adminToken()) return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  const form = await req.formData();
  const supplied = form.get("token");
  if (typeof supplied !== "string" || !tokenMatches(supplied)) return unauthorized(req);
  return setCookieAndRedirect(req, supplied);
}
