import { NextRequest, NextResponse } from "next/server";
import {
  CREATOR_COOKIE,
  CREATOR_COOKIE_MAX_AGE_S,
  authenticateToken,
} from "@/lib/creator-auth";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_NEXT_RE = /^\/dashboard(?:\/.*)?$/;

/**
 * Form POST counterpart of `/api/creator/session`. The dashboard sign-in is
 * a no-JS HTML form (so people can paste a token from email and just hit
 * Enter); this route accepts the form-encoded body, validates the token,
 * sets the cookie, and 302s back into the dashboard.
 *
 * The `next` param is constrained to `/dashboard*` to keep this from being
 * an open redirect.
 */

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

function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/dashboard";
  if (!SAFE_NEXT_RE.test(raw)) return "/dashboard";
  return raw;
}

/**
 * GET: clear the creator cookie. Used by `/dashboard` (server component) to
 * recycle a stale cookie when getCreator() returns null but the browser
 * still holds a `mindforum_creator_session` value (token rotated, creator
 * disabled, or row deleted). Redirects back to /dashboard so the SignInForm
 * renders with `?err=session_expired`. Same `next` allowlist as POST.
 */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const url = publicUrl(req, "/dashboard");
  url.searchParams.set("err", "session_expired");
  if (next !== "/dashboard") url.searchParams.set("next", next);
  const res = NextResponse.redirect(url);
  res.cookies.set(CREATOR_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function POST(req: NextRequest) {
  const rate = checkRate("creator-session", clientIp(req), 10, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const form = await req.formData();
  const supplied = form.get("token");
  const next = safeNext(form.get("next") as string | null);

  if (typeof supplied !== "string" || !supplied.trim()) {
    const url = publicUrl(req, "/dashboard");
    url.searchParams.set("err", "missing_token");
    return NextResponse.redirect(url);
  }

  const creator = await authenticateToken(supplied.trim());
  if (!creator) {
    const url = publicUrl(req, "/dashboard");
    url.searchParams.set("err", "bad_token");
    return NextResponse.redirect(url);
  }

  const res = NextResponse.redirect(publicUrl(req, next));
  res.cookies.set(CREATOR_COOKIE, supplied.trim(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CREATOR_COOKIE_MAX_AGE_S,
  });
  return res;
}
