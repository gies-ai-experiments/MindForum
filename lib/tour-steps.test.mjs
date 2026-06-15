import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectVisibleSteps,
  tourSeen,
  markTourSeen,
  ROOM_TOUR_STEPS,
  DASHBOARD_TOUR_STEPS,
  TOUR_KEYS,
} from "./tour-steps.ts";

test("selectVisibleSteps keeps only steps whose target is visible, in order", () => {
  const steps = [
    { selector: "#a", title: "", body: "" },
    { selector: "#b", title: "", body: "" },
    { selector: "#c", title: "", body: "" },
  ];
  const visible = new Set(["#c", "#a"]);
  const result = selectVisibleSteps(steps, (s) => visible.has(s));
  assert.deepEqual(result.map((s) => s.selector), ["#a", "#c"]);
});

test("selectVisibleSteps returns [] when nothing is visible", () => {
  assert.deepEqual(selectVisibleSteps(ROOM_TOUR_STEPS, () => false), []);
});

test("tourSeen/markTourSeen roundtrip through an injected store", () => {
  const m = new Map();
  const store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  assert.equal(tourSeen("k", store), false);
  markTourSeen("k", store);
  assert.equal(tourSeen("k", store), true);
});

test("step copy references the headline features", () => {
  const roomText = ROOM_TOUR_STEPS.map((s) => s.title + s.body).join(" ");
  assert.match(roomText, /@ai/);
  assert.match(roomText, /\/poll/);
  assert.match(roomText, /brief/i);
  assert.ok(DASHBOARD_TOUR_STEPS.length >= 4);
  assert.ok(TOUR_KEYS.room.startsWith("mindforum_tour_"));
});
