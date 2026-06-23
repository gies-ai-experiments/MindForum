import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENTION_REMINDER_DELAY_MS,
  groupRemindersByAuthor,
  formatNameList,
} from "./mention-reminders.ts";

const row = (over) => ({
  id: "r", roomId: "room1", roomName: "Room One",
  authorId: "a1", authorName: "Alice", authorEmail: "alice@x",
  mentionedName: "Bob", ...over,
});

test("delay constant is one hour", () => {
  assert.equal(MENTION_REMINDER_DELAY_MS, 60 * 60 * 1000);
});

test("groups by (room, author) and lists names", () => {
  const groups = groupRemindersByAuthor([
    row({ id: "1", mentionedName: "Bob" }),
    row({ id: "2", mentionedName: "Carol" }),
    row({ id: "3", authorId: "a2", authorName: "Zoe", authorEmail: "zoe@x", mentionedName: "Bob" }),
  ]);
  assert.equal(groups.length, 2);
  const alice = groups.find((g) => g.authorId === "a1");
  assert.deepEqual(alice.mentionedNames.sort(), ["Bob", "Carol"]);
  assert.equal(alice.roomName, "Room One");
});

test("same author across different rooms stays separate", () => {
  const groups = groupRemindersByAuthor([
    row({ id: "1", roomId: "room1", mentionedName: "Bob" }),
    row({ id: "2", roomId: "room2", roomName: "Room Two", mentionedName: "Bob" }),
  ]);
  assert.equal(groups.length, 2);
});

test("dedupes a repeated mentioned name within a group", () => {
  const groups = groupRemindersByAuthor([
    row({ id: "1", mentionedName: "Bob" }),
    row({ id: "2", mentionedName: "Bob" }),
  ]);
  assert.deepEqual(groups[0].mentionedNames, ["Bob"]);
});

test("formatNameList handles 1, 2, 3, and 4+ names", () => {
  assert.equal(formatNameList(["A"]), "A");
  assert.equal(formatNameList(["A", "B"]), "A and B");
  assert.equal(formatNameList(["A", "B", "C"]), "A, B and C");
  assert.equal(formatNameList(["A", "B", "C", "D"]), "A, B, C and 1 other");
  assert.equal(formatNameList(["A", "B", "C", "D", "E"]), "A, B, C and 2 others");
});
