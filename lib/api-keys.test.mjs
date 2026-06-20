import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  apiKeyLastFour,
  parseBearerToken,
} from "./api-keys.ts";

test("generateApiKey returns a prefixed, unique token", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.ok(a.startsWith(API_KEY_PREFIX));
  assert.notEqual(a, b);
  assert.ok(a.length > API_KEY_PREFIX.length + 40);
});

test("hashApiKey is deterministic 64-hex, not the plaintext", () => {
  const k = generateApiKey();
  const h = hashApiKey(k);
  assert.equal(h, hashApiKey(k));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, k);
});

test("apiKeyLastFour returns the trailing 4 chars", () => {
  assert.equal(apiKeyLastFour("mf_sk_abcdef1234"), "1234");
});

test("parseBearerToken accepts a well-formed header (scheme case-insensitive)", () => {
  const k = generateApiKey();
  assert.equal(parseBearerToken(`Bearer ${k}`), k);
  assert.equal(parseBearerToken(`bearer ${k}`), k);
});

test("parseBearerToken rejects malformed or non-prefixed values", () => {
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken(""), null);
  assert.equal(parseBearerToken("Bearer"), null);
  assert.equal(parseBearerToken("Token mf_sk_x"), null);
  assert.equal(parseBearerToken("Bearer some-other-token"), null);
});
