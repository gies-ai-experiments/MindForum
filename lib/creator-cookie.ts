// Edge-safe constants for the creator cookie. `middleware.ts` imports from
// here so it doesn't pull `crypto`/`pg`/`next/headers` (all Node-only) into
// the Edge bundle. `lib/creator-auth.ts` re-exports these for callers that
// already live in the Node runtime.

export const CREATOR_COOKIE = "mindforum_creator_session";
export const CREATOR_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365; // 1y
