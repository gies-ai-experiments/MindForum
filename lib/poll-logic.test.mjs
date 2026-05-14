import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTallies,
  validateOptions,
  isExpired,
} from "./poll-logic.ts";

test("computeTallies — clear winner", () => {
  const options = [
    { id: "po_a", position: 0, text: "A" },
    { id: "po_b", position: 1, text: "B" },
    { id: "po_c", position: 2, text: "C" },
  ];
  const votes = [
    { optionId: "po_a" }, { optionId: "po_a" }, { optionId: "po_a" },
    { optionId: "po_b" },
  ];
  const r = computeTallies(options, votes);
  assert.equal(r.totalVotes, 4);
  assert.equal(r.winnerOptionId, "po_a");
  assert.equal(r.inconclusive, false);
  assert.deepEqual(
    r.tallies.map(t => [t.optionId, t.votes]),
    [["po_a", 3], ["po_b", 1], ["po_c", 0]],
  );
});

test("computeTallies — two-way tie at top is inconclusive", () => {
  const options = [
    { id: "po_a", position: 0, text: "A" },
    { id: "po_b", position: 1, text: "B" },
  ];
  const votes = [{ optionId: "po_a" }, { optionId: "po_b" }];
  const r = computeTallies(options, votes);
  assert.equal(r.totalVotes, 2);
  assert.equal(r.winnerOptionId, null);
  assert.equal(r.inconclusive, true);
});

test("computeTallies — single voter is inconclusive (totalVotes < 2)", () => {
  const options = [
    { id: "po_a", position: 0, text: "A" },
    { id: "po_b", position: 1, text: "B" },
  ];
  const votes = [{ optionId: "po_a" }];
  const r = computeTallies(options, votes);
  assert.equal(r.totalVotes, 1);
  assert.equal(r.winnerOptionId, "po_a");
  assert.equal(r.inconclusive, true);
});

test("computeTallies — zero votes", () => {
  const options = [{ id: "po_a", position: 0, text: "A" }];
  const r = computeTallies(options, []);
  assert.equal(r.totalVotes, 0);
  assert.equal(r.winnerOptionId, null);
  assert.equal(r.inconclusive, true);
});

test("validateOptions — accepts 2-5 unique non-empty", () => {
  assert.deepEqual(validateOptions(["A", "B"]), { ok: true, normalized: ["A", "B"] });
  assert.deepEqual(
    validateOptions(["A", "B", "C", "D", "E"]),
    { ok: true, normalized: ["A", "B", "C", "D", "E"] },
  );
});

test("validateOptions — trims, drops empty", () => {
  assert.deepEqual(
    validateOptions(["  A  ", "", "B", "   "]),
    { ok: true, normalized: ["A", "B"] },
  );
});

test("validateOptions — rejects <2", () => {
  assert.deepEqual(validateOptions(["A"]), { ok: false, error: "min_options" });
  assert.deepEqual(validateOptions([""]), { ok: false, error: "min_options" });
});

test("validateOptions — rejects >5", () => {
  assert.deepEqual(
    validateOptions(["A", "B", "C", "D", "E", "F"]),
    { ok: false, error: "max_options" },
  );
});

test("validateOptions — rejects case-insensitive duplicates", () => {
  assert.deepEqual(
    validateOptions(["Apple", "apple"]),
    { ok: false, error: "duplicate_options" },
  );
});

test("isExpired — open + past closes_at → true", () => {
  assert.equal(isExpired({ status: "open", closesAt: Date.now() - 1 }), true);
});

test("isExpired — open + future closes_at → false", () => {
  assert.equal(isExpired({ status: "open", closesAt: Date.now() + 60_000 }), false);
});

test("isExpired — manual (closesAt null) → false", () => {
  assert.equal(isExpired({ status: "open", closesAt: null }), false);
});

test("isExpired — already closed → false (idempotent)", () => {
  assert.equal(isExpired({ status: "closed", closesAt: Date.now() - 1 }), false);
});
