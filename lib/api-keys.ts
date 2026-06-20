// Pure helpers for programmatic API keys. No I/O — safe to unit-test.
//
// Keys are `mf_sk_` + 32 random bytes (base64url). We store sha256(plaintext)
// only; the bearer token IS the plaintext, hashed per request to find the row.
// Mirrors lib/creator-auth.ts token handling.

import crypto from "crypto";

export const API_KEY_PREFIX = "mf_sk_";

/** Generate a fresh plaintext API key: `mf_sk_` + 32 random bytes base64url. */
export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a plaintext key, for storage / lookup. */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

/** Last-4 chars of the plaintext key, for display. */
export function apiKeyLastFour(plaintext: string): string {
  return plaintext.slice(-4);
}

/**
 * Extract the bearer token from an Authorization header value. Returns the
 * token iff it's a well-formed `Bearer <mf_sk_…>`; null otherwise. Pure.
 */
export function parseBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const token = m[1];
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  return token;
}
