import { cookies } from "next/headers";

/**
 * Facilitator identity cookie — set once by the admin via /api/admin/identity,
 * then reused on every "Join" click from /admin/rooms. Stored httpOnly so
 * the value isn't readable from page JS.
 */

export const ADMIN_IDENTITY_COOKIE = "mf_admin_identity";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

export type AdminIdentity = { name: string; email: string };

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const c = await cookies();
  const raw = c.get(ADMIN_IDENTITY_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.name === "string" && typeof v?.email === "string") {
      return { name: v.name, email: v.email };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function adminIdentityCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_S,
  };
}
