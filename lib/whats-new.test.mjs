import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WHATS_NEW_ROOM,
  WHATS_NEW_DASH,
  WHATS_NEW_KEYS,
  unseenWhatsNew,
  markWhatsNewSeen,
} from "./whats-new.ts";

function fakeStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
  };
}

const STEPS = [
  { id: "a", selector: "#a", title: "A", body: "a" },
  { id: "b", selector: "#b", title: "B", body: "b" },
  { id: "c", selector: "#c", title: "C", body: "c" },
];
const KEY = "k";

test("first visit (no marker) returns [] — caught up, no history dump", () => {
  assert.deepEqual(unseenWhatsNew(STEPS, fakeStore(), KEY), []);
});

test("marker at an older step returns only the steps after it (newest)", () => {
  const r = unseenWhatsNew(STEPS, fakeStore({ k: "a" }), KEY);
  assert.deepEqual(r.map((s) => s.id), ["b", "c"]);
});

test("marker at the newest step returns []", () => {
  assert.deepEqual(unseenWhatsNew(STEPS, fakeStore({ k: "c" }), KEY), []);
});

test("unknown/stale marker returns all steps", () => {
  const r = unseenWhatsNew(STEPS, fakeStore({ k: "gone" }), KEY);
  assert.deepEqual(r.map((s) => s.id), ["a", "b", "c"]);
});

test("markWhatsNewSeen stores the newest (last) step id", () => {
  const s = fakeStore();
  markWhatsNewSeen(STEPS, s, KEY);
  assert.equal(s.getItem(KEY), "c");
});

test("markWhatsNewSeen with no steps is a no-op", () => {
  const s = fakeStore();
  markWhatsNewSeen([], s, KEY);
  assert.equal(s.getItem(KEY), null);
});

test("real changelogs are well-formed with unique ids, and keys exist", () => {
  for (const list of [WHATS_NEW_ROOM, WHATS_NEW_DASH]) {
    const ids = list.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, "ids must be unique");
    for (const s of list) assert.ok(s.id && s.selector && s.title && s.body, "step well-formed");
  }
  assert.ok(WHATS_NEW_KEYS.room && WHATS_NEW_KEYS.dashboard);
});
