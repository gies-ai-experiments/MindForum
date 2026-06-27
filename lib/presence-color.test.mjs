import { test } from "node:test";
import assert from "node:assert/strict";
import {
  presenceColor,
  presenceLabel,
  YELLOW_TTL_MS,
  GREEN_GRACE_MS,
} from "./presence-color.ts";

const NOW = 1_700_000_000_000;

test("online is always green regardless of lastSeenAt", () => {
  assert.equal(presenceColor(true, null, NOW), "green");
  assert.equal(presenceColor(true, NOW - YELLOW_TTL_MS * 10, NOW), "green");
});

test("offline within green-grace stays green (refresh-flicker guard)", () => {
  assert.equal(presenceColor(false, NOW - (GREEN_GRACE_MS - 1), NOW), "green");
});

test("offline past grace but within yellow window is yellow", () => {
  assert.equal(presenceColor(false, NOW - (GREEN_GRACE_MS + 1), NOW), "yellow");
  assert.equal(presenceColor(false, NOW - (YELLOW_TTL_MS - 1), NOW), "yellow");
});

test("offline beyond yellow window is none", () => {
  assert.equal(presenceColor(false, NOW - (YELLOW_TTL_MS + 1), NOW), "none");
});

test("offline with null lastSeenAt is none", () => {
  assert.equal(presenceColor(false, null, NOW), "none");
});

test("presenceLabel reflects state", () => {
  assert.equal(presenceLabel(true, null, NOW), "Online");
  assert.equal(presenceLabel(false, null, NOW), "Offline");
  assert.equal(presenceLabel(false, NOW - 5 * 60_000, NOW), "Last seen 5m ago");
});

test("presenceLabel rounds up to at least 1 minute", () => {
  assert.equal(presenceLabel(false, NOW - (GREEN_GRACE_MS + 1), NOW), "Last seen 1m ago");
});
