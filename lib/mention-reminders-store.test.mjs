// Run against a local Postgres test DB:
//   createdb mindforum_test; POSTGRES_URL=postgres://localhost/mindforum_test npm run migrate
//   POSTGRES_URL=postgres://localhost/mindforum_test node --import tsx --test lib/mention-reminders-store.test.mjs
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createRoom, upsertParticipant, appendMessage, setParticipantMuted,
  getActiveParticipants, armMentionReminders, resolveMentionRemindersFor,
} from "./store.ts";
import { nanoid } from "nanoid";

let ROOM, alice, bob, carol;

before(async () => {
  const room = await createRoom("mr-arm-" + nanoid(6), "admin", "");
  ROOM = room.id;
  alice = (await upsertParticipant(ROOM, "Alice", "alice@x")).id;
  bob = (await upsertParticipant(ROOM, "Bob", "bob@x")).id;
  carol = (await upsertParticipant(ROOM, "Carol", "carol@x")).id;
});

async function postMessage(authorId, authorName, content) {
  const id = nanoid(10);
  await appendMessage({ id, roomId: ROOM, authorId, authorName, content, createdAt: Date.now(), kind: "chat" });
  return id;
}

test("getActiveParticipants excludes muted and removed", async () => {
  await setParticipantMuted(ROOM, carol, true);
  const active = await getActiveParticipants(ROOM);
  const ids = active.map((p) => p.id);
  assert.ok(ids.includes(alice) && ids.includes(bob));
  assert.ok(!ids.includes(carol));
  await setParticipantMuted(ROOM, carol, false); // restore for later tests
});

test("arm inserts a pending row; resolve flips the target's pending rows", async () => {
  const mid = await postMessage(alice, "Alice", "@bob ping");
  await armMentionReminders({
    roomId: ROOM, messageId: mid, createdAt: Date.now(),
    author: { id: alice, name: "Alice", email: "alice@x" },
    mentioned: [{ id: bob, name: "Bob" }],
    delayMs: 60 * 60 * 1000,
  });
  // Bob posts -> his pending incoming mentions resolve.
  const n = await resolveMentionRemindersFor(ROOM, bob);
  assert.equal(n, 1);
  // Resolving again finds nothing.
  assert.equal(await resolveMentionRemindersFor(ROOM, bob), 0);
});

test("resolve only touches the poster's own incoming mentions", async () => {
  const mid = await postMessage(alice, "Alice", "@bob @carol look");
  await armMentionReminders({
    roomId: ROOM, messageId: mid, createdAt: Date.now(),
    author: { id: alice, name: "Alice", email: "alice@x" },
    mentioned: [{ id: bob, name: "Bob" }, { id: carol, name: "Carol" }],
    delayMs: 60 * 60 * 1000,
  });
  // Carol posting resolves only Carol's row, not Bob's.
  assert.equal(await resolveMentionRemindersFor(ROOM, carol), 1);
  assert.equal(await resolveMentionRemindersFor(ROOM, bob), 1);
});
