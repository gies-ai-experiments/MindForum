import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDirectMentions } from "./mention-parse.ts";

const PEOPLE = [
  { id: "p1", name: "Alice Smith", email: "alice@x" },
  { id: "p2", name: "Bob Jones", email: "bob@x" },
  { id: "p3", name: "Carol Diaz", email: "carol@x" },
];

test("matches by first name, case-insensitive", () => {
  const r = extractDirectMentions("hey @alice can you look?", PEOPLE, "p2");
  assert.deepEqual(r.map((m) => m.id), ["p1"]);
});

test("matches by full name", () => {
  const r = extractDirectMentions("ping @Bob Jones please", PEOPLE, "p1");
  assert.deepEqual(r.map((m) => m.id), ["p2"]);
});

test("respects word boundary (no @aliceandbob match)", () => {
  const r = extractDirectMentions("see @alicexyz", PEOPLE, "p2");
  assert.deepEqual(r, []);
});

test("excludes the author (no self-reminder)", () => {
  const r = extractDirectMentions("note to @alice from me", PEOPLE, "p1");
  assert.deepEqual(r, []);
});

test("excludes @ai, @all, @everyone", () => {
  const r = extractDirectMentions("@ai summarize, @all heads up, @everyone hi", PEOPLE, "p1");
  assert.deepEqual(r, []);
});

test("dedupes a person mentioned twice in one message", () => {
  const r = extractDirectMentions("@alice and again @Alice Smith", PEOPLE, "p2");
  assert.deepEqual(r.map((m) => m.id), ["p1"]);
});

test("returns multiple distinct mentions, with email", () => {
  const r = extractDirectMentions("@alice @carol look", PEOPLE, "p2");
  assert.deepEqual(r.map((m) => m.id).sort(), ["p1", "p3"]);
  assert.equal(r.find((m) => m.id === "p1").email, "alice@x");
});

test("empty content -> []", () => {
  assert.deepEqual(extractDirectMentions("", PEOPLE, "p1"), []);
});
