import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePromptGenInput } from "./prompt-gen.ts";
import { MAX_SYSTEM_PROMPT_CHARS } from "./limits.ts";

test("accepts and trims a valid description", () => {
  const r = parsePromptGenInput({ description: "  help four faculty brainstorm a grant  " });
  assert.deepEqual(r, { ok: true, description: "help four faculty brainstorm a grant" });
});

test("rejects a missing or non-string description", () => {
  assert.deepEqual(parsePromptGenInput({}), { ok: false, error: "description_required" });
  assert.deepEqual(parsePromptGenInput({ description: 42 }), { ok: false, error: "description_required" });
  assert.deepEqual(parsePromptGenInput(null), { ok: false, error: "description_required" });
});

test("rejects a too-short / whitespace-only description", () => {
  assert.deepEqual(parsePromptGenInput({ description: "   " }), { ok: false, error: "description_required" });
  assert.deepEqual(parsePromptGenInput({ description: "hi" }), { ok: false, error: "description_required" });
});

test("rejects an over-cap description", () => {
  const r = parsePromptGenInput({ description: "x".repeat(MAX_SYSTEM_PROMPT_CHARS + 1) });
  assert.deepEqual(r, { ok: false, error: "description_too_long" });
});
