import { NextRequest, NextResponse } from "next/server";
import {
  CREATOR_COOKIE,
  CREATOR_COOKIE_MAX_AGE_S,
  authenticateToken,
  httpErrorResponse,
  requireJsonContent,
} from "@/lib/creator-auth";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * POST: validate the pasted token, set the creator session cookie. The cookie
 * value IS the plaintext token — server hashes per request to look up the
 * row. Spec: 10/min per IP rate limit, narrow enough that brute-force is
 * impractical against a 256-bit token while leaving room for honest mistypes.
 */
export async function POST(req: NextRequest) {
  const rate = checkRate("creator-session", clientIp(req), 10, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  try {
    requireJsonContent(req);
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ error: "missing_token" }, { status: 400 });
    }
    const creator = await authenticateToken(token);
    if (!creator) {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    const res = NextResponse.json({
      id: creator.id,
      email: creator.email,
      displayName: creator.displayName,
      isSuperAdmin: creator.isSuperAdmin,
    });
    res.cookies.set(CREATOR_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: CREATOR_COOKIE_MAX_AGE_S,
    });
    return res;
  } catch (err) {
    return httpErrorResponse(err);
  }
}

/**
 * DELETE: clear BOTH session paths — the creator-token cookie and the Auth.js
 * (Entra ID) session cookie. The session uses the JWT strategy (stateless), so
 * expiring the cookie fully ends the session; without this, an Entra user is
 * re-authenticated by `getCreator()` the instant they land back on /dashboard
 * and can never actually sign out. Always 204 — sign-out is idempotent.
 */
export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(CREATOR_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  // Expire the Auth.js session cookie under every name it may carry: v5
  // (`authjs.*`) and legacy v4 (`next-auth.*`), each with and without the
  // `__Secure-` prefix (production HTTPS adds it). A `__Secure-` cookie can
  // only be cleared with Secure set, so those entries force secure: true.
  const authCookies: Array<{ name: string; secure: boolean }> = [
    { name: "__Secure-authjs.session-token", secure: true },
    { name: "authjs.session-token", secure: false },
    { name: "__Secure-next-auth.session-token", secure: true },
    { name: "next-auth.session-token", secure: false },
  ];
  for (const { name, secure } of authCookies) {
    res.cookies.set(name, "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}
