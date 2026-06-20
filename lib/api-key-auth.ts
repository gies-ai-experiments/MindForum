// Route-layer bearer auth for the programmatic API (/api/v1/*).
// Wraps the pure parser + the store lookup; throws HttpError so handlers funnel
// through httpErrorResponse like the cookie-auth routes do.

import { parseBearerToken } from "./api-keys";
import { authenticateApiKey, touchApiKeyLastUsed } from "./api-key-store";
import { HttpError, type Creator } from "./creator-auth";

/**
 * Require a valid `Authorization: Bearer mf_sk_…` header. Returns the owning
 * creator + key id. Throws:
 *   HttpError(401,"missing_authorization") — no/malformed header
 *   HttpError(401,"invalid_key")           — no matching key
 *   HttpError(401,"key_revoked")           — key revoked
 *   HttpError(403,"creator_disabled")      — owning creator disabled
 * On success, best-effort stamps last_used_at (never blocks).
 */
export async function requireApiKey(req: Request): Promise<{ creator: Creator; keyId: string }> {
  const token = parseBearerToken(req.headers.get("authorization"));
  if (!token) throw new HttpError(401, "missing_authorization");
  const result = await authenticateApiKey(token);
  if (!result.ok) {
    if (result.reason === "creator_disabled") throw new HttpError(403, "creator_disabled");
    throw new HttpError(401, result.reason); // invalid_key | key_revoked
  }
  void touchApiKeyLastUsed(result.keyId);
  return { creator: result.creator, keyId: result.keyId };
}
