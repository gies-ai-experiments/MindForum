import { test } from "node:test";
import assert from "node:assert/strict";
import { markOnline, markOffline, onlineParticipantIds } from "./presence.ts";

test("first connection marks online (0->1 transition)", () => {
  assert.equal(markOnline("room-a", "p1"), true);
  assert.ok(onlineParticipantIds("room-a").has("p1"));
});

test("second connection of the same participant is not a transition", () => {
  markOnline("room-b", "p1");
  assert.equal(markOnline("room-b", "p1"), false);
});

test("offline only transitions when the last connection closes", () => {
  markOnline("room-c", "p1"); // count 1
  markOnline("room-c", "p1"); // count 2
  assert.equal(markOffline("room-c", "p1"), false); // → count 1, still online
  assert.ok(onlineParticipantIds("room-c").has("p1"));
  assert.equal(markOffline("room-c", "p1"), true); // → count 0, now offline
  assert.equal(onlineParticipantIds("room-c").has("p1"), false);
});

test("markOffline on an unknown participant returns false", () => {
  assert.equal(markOffline("room-d", "ghost"), false);
});

test("rooms are isolated", () => {
  markOnline("room-e", "p1");
  assert.equal(onlineParticipantIds("room-f").has("p1"), false);
});
