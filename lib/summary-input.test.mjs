import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SUMMARY_TEXT_CHARS,
  validateSummaryRequest,
  summaryFilename,
} from "./summary-input.ts";

test("accepts source=room", () => {
  const r = validateSummaryRequest({ source: "room" });
  assert.deepEqual(r, { ok: true, value: { source: "room", post: true } });
});

test("accepts post=false for preview-only summary", () => {
  assert.deepEqual(validateSummaryRequest({ source: "room", post: false }), {
    ok: true,
    value: { source: "room", post: false },
  });
});

test("accepts source=text with content (trimmed)", () => {
  const r = validateSummaryRequest({ source: "text", text: "  hello  " });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { source: "text", text: "hello", post: true });
});

test("rejects bad source", () => {
  assert.deepEqual(validateSummaryRequest({ source: "nope" }), { ok: false, error: "bad_source" });
  assert.deepEqual(validateSummaryRequest({}), { ok: false, error: "bad_source" });
});

test("rejects empty text", () => {
  assert.deepEqual(validateSummaryRequest({ source: "text", text: "   " }), { ok: false, error: "text_required" });
  assert.deepEqual(validateSummaryRequest({ source: "text" }), { ok: false, error: "text_required" });
});

test("rejects oversized text", () => {
  const big = "x".repeat(MAX_SUMMARY_TEXT_CHARS + 1);
  assert.deepEqual(validateSummaryRequest({ source: "text", text: big }), { ok: false, error: "text_too_long" });
});

test("summaryFilename uses date stamp", () => {
  const f = summaryFilename(Date.parse("2026-06-23T12:34:56Z"));
  assert.equal(f, "mindforum-summary-2026-06-23.md");
});
