import { NextRequest, NextResponse } from "next/server";
import { CREATOR_COOKIE } from "@/lib/creator-cookie";

/**
 * Gate `/dashboard/*` sub-routes on the creator cookie or a NextAuth session
 * cookie. The `/dashboard` root self-renders the sign-in form when no cookie
 * is present (so it must be excluded here to avoid a redirect loop).
 * Sub-routes (settings pages) need an actual cookie before rendering — they
 * redirect to `/dashboard` so the user can sign in, with `?next=` preserving
 * where they were headed.
 *
 * `/api/auth/*` is the NextAuth callback route — must be excluded so the
 * OAuth dance can complete without a creator cookie (the cookie only gets
 * set AFTER successful auth).
 *
 * `/admin/*` is unchanged: it uses the existing ADMIN_TOKEN cookie path
 * (lib/admin-auth.ts) which the page server components handle themselves.
 *
 * Note: this middleware doesn't validate the cookie value (would require a
 * DB round-trip per request); presence is enough for the gate. Routes still
 * call `requireCreator` / `getActor`, which do the actual hash lookup and
 * reject expired / rotated tokens.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // NextAuth OAuth callbacks must complete before any creator cookie exists
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  // /dashboard/auth is the token-paste form POST target — must reach the
  // route handler even without a cookie (that's how the cookie GETS set).
  if (pathname === "/dashboard/auth") return NextResponse.next();

  // Check for creator cookie (token-paste flow)
  const hasCreatorCookie = req.cookies.get(CREATOR_COOKIE)?.value;
  if (hasCreatorCookie) return NextResponse.next();

  // Check for NextAuth session cookie (Entra ID flow).
  // Auth.js v5 (next-auth@5) renamed the default cookie prefix from
  // `next-auth` → `authjs`, and adds the `__Secure-` prefix when the
  // deployment is HTTPS (production). Check the v5 names first, then the
  // legacy v4 names so the gate keeps working across versions.
  const hasNextAuthCookie =
    req.cookies.get("__Secure-authjs.session-token")?.value ||
    req.cookies.get("authjs.session-token")?.value ||
    req.cookies.get("__Secure-next-auth.session-token")?.value ||
    req.cookies.get("next-auth.session-token")?.value;
  if (hasNextAuthCookie) return NextResponse.next();

  // Neither cookie present — redirect to sign-in
  const url = new URL("/dashboard", req.nextUrl);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Match every /dashboard sub-route, but NOT /dashboard itself (root handles
  // its own no-cookie case). The negative lookahead excludes the root.
  matcher: ["/dashboard/:path+"],
};
