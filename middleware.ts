import { NextRequest, NextResponse } from "next/server";
import { CREATOR_COOKIE } from "@/lib/creator-cookie";

/**
 * Gate `/dashboard/*` sub-routes on the creator cookie. The `/dashboard`
 * root self-renders the token-paste form when no cookie is present (so it
 * must be excluded here to avoid a redirect loop). Sub-routes (settings
 * pages) need an actual cookie before rendering — they redirect to
 * `/dashboard` so the user can sign in, with `?next=` preserving where they
 * were headed.
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
  // /dashboard/auth is the form POST target — must reach the route handler
  // even without a cookie (that's how the cookie GETS set).
  if (pathname === "/dashboard/auth") return NextResponse.next();
  const hasCookie = req.cookies.get(CREATOR_COOKIE)?.value;
  if (!hasCookie) {
    const url = new URL("/dashboard", req.nextUrl);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Match every /dashboard sub-route, but NOT /dashboard itself (root handles
  // its own no-cookie case). The negative lookahead excludes the root.
  matcher: ["/dashboard/:path+"],
};
