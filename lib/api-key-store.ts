// DB layer for programmatic API keys (migration v14, table api_keys).
// Not unit-tested (DB-bound, like lib/store.ts); verified in the acceptance
// walk. Pure crypto lives in lib/api-keys.ts.

import { nanoid } from "nanoid";
import crypto from "crypto";
import { query } from "./db";
import { generateApiKey, hashApiKey, apiKeyLastFour } from "./api-keys";
import type { Creator } from "./creator-auth";

export type ApiKeyMeta = {
  id: string;
  creatorId: string;
  name: string;
  keyLastFour: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

type ApiKeyRow = {
  id: string;
  creator_id: string;
  name: string;
  key_last_four: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};

function toMeta(r: ApiKeyRow): ApiKeyMeta {
  return {
    id: r.id,
    creatorId: r.creator_id,
    name: r.name,
    keyLastFour: r.key_last_four,
    createdAt: r.created_at.getTime(),
    lastUsedAt: r.last_used_at ? r.last_used_at.getTime() : null,
    revokedAt: r.revoked_at ? r.revoked_at.getTime() : null,
  };
}

/** Mint a new API key for a creator. Returns metadata + the one-time plaintext. */
export async function createApiKey(input: {
  creatorId: string;
  name: string;
}): Promise<{ apiKey: ApiKeyMeta; plaintextKey: string }> {
  const plaintextKey = generateApiKey();
  const id = `ak_${nanoid(12)}`;
  const { rows } = await query<ApiKeyRow>(
    `INSERT INTO api_keys (id, creator_id, name, key_hash, key_last_four)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, creator_id, name, key_last_four, created_at, last_used_at, revoked_at`,
    [id, input.creatorId, input.name, hashApiKey(plaintextKey), apiKeyLastFour(plaintextKey)]
  );
  return { apiKey: toMeta(rows[0]), plaintextKey };
}

export type ApiKeyAuthResult =
  | { ok: true; creator: Creator; keyId: string }
  | { ok: false; reason: "invalid_key" | "key_revoked" | "creator_disabled" };

/**
 * Resolve a plaintext bearer key to its owning creator. JOINs api_keys →
 * allowlisted_creators. Distinguishes not-found / revoked / disabled so the
 * route maps status codes. Lookup is by the unique key_hash index; a
 * timingSafeEqual recheck guards against future schema changes.
 */
export async function authenticateApiKey(plaintext: string): Promise<ApiKeyAuthResult> {
  if (!plaintext) return { ok: false, reason: "invalid_key" };
  const h = hashApiKey(plaintext);
  const { rows } = await query<{
    key_id: string;
    key_hash: string;
    revoked_at: Date | null;
    creator_id: string;
    email: string;
    display_name: string;
    is_super_admin: boolean;
    disabled_at: Date | null;
  }>(
    `SELECT k.id AS key_id, k.key_hash, k.revoked_at,
            c.id AS creator_id, c.email, c.display_name, c.is_super_admin, c.disabled_at
       FROM api_keys k
       JOIN allowlisted_creators c ON c.id = k.creator_id
      WHERE k.key_hash = $1
      LIMIT 1`,
    [h]
  );
  const r = rows[0];
  if (!r) return { ok: false, reason: "invalid_key" };
  const a = Buffer.from(h);
  const b = Buffer.from(r.key_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid_key" };
  }
  if (r.revoked_at) return { ok: false, reason: "key_revoked" };
  if (r.disabled_at) return { ok: false, reason: "creator_disabled" };
  return {
    ok: true,
    keyId: r.key_id,
    creator: {
      id: r.creator_id,
      email: r.email,
      displayName: r.display_name,
      isSuperAdmin: r.is_super_admin,
      disabledAt: null,
    },
  };
}

/** List a creator's keys (newest first). Never returns hash or plaintext. */
export async function listApiKeysByCreator(creatorId: string): Promise<ApiKeyMeta[]> {
  const { rows } = await query<ApiKeyRow>(
    `SELECT id, creator_id, name, key_last_four, created_at, last_used_at, revoked_at
       FROM api_keys
      WHERE creator_id = $1
      ORDER BY created_at DESC`,
    [creatorId]
  );
  return rows.map(toMeta);
}

/**
 * Soft-revoke a key. Self-service callers pass `creatorId`, so the key must
 * belong to them (else ok:false — no cross-creator id-guessing). Admin callers
 * pass `byAdmin: true` to revoke any key. Idempotent on already-revoked.
 */
export async function revokeApiKey(
  keyId: string,
  opts: { creatorId?: string; byAdmin?: boolean; revokedBy: string }
): Promise<{ ok: boolean }> {
  const sql = opts.byAdmin
    ? `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, NOW()), revoked_by = $2 WHERE id = $1`
    : `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, NOW()), revoked_by = $2 WHERE id = $1 AND creator_id = $3`;
  const params = opts.byAdmin ? [keyId, opts.revokedBy] : [keyId, opts.revokedBy, opts.creatorId];
  const { rowCount } = await query(sql, params);
  return { ok: (rowCount ?? 0) > 0 };
}

/** Best-effort last-used stamp. Never throws (auth must not fail on this). */
export async function touchApiKeyLastUsed(keyId: string): Promise<void> {
  try {
    await query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [keyId]);
  } catch (err) {
    console.error("touchApiKeyLastUsed failed:", err);
  }
}
