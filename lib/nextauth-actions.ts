"use server";

import { signIn, signOut } from "./auth-config";

// Same allowlist as app/dashboard/auth/route.ts: only same-origin /dashboard
// paths are honored, so a redirect can't be pointed off-site or to an
// arbitrary route. Anything else falls back to the dashboard root.
const SAFE_NEXT_RE = /^\/dashboard(?:\/.*)?$/;
function safeNext(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string" || !SAFE_NEXT_RE.test(raw)) return "/dashboard";
  return raw;
}

export async function signInAzure(formData?: FormData) {
  const next = safeNext(formData?.get("next") ?? null);
  await signIn("microsoft-entra-id", { redirectTo: next });
}

export async function signOutCreator() {
  await signOut({ redirectTo: "/dashboard" });
}
