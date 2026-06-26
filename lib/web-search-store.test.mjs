// Run against a local Postgres test DB:
//   createdb mindforum_test; POSTGRES_URL=postgres://localhost/mindforum_test npm run migrate
//   POSTGRES_URL=postgres://localhost/mindforum_test node --import tsx --test lib/web-search-store.test.mjs
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createRoom,
  getRoom,
  isWebSearchEnabled,
  setWebSearchEnabled,
} from "./store.ts";
import { nanoid } from "nanoid";

let ROOM;

before(async () => {
  const room = await createRoom("ws-" + nanoid(6), "admin", "");
  ROOM = room.id;
});

test("web search defaults to off for a new room", async () => {
  assert.equal(await isWebSearchEnabled(ROOM), false);
  const room = await getRoom(ROOM);
  assert.equal(room.webSearchEnabled, false);
});

test("setWebSearchEnabled(true) turns it on and is reflected by getRoom", async () => {
  await setWebSearchEnabled(ROOM, true);
  assert.equal(await isWebSearchEnabled(ROOM), true);
  const room = await getRoom(ROOM);
  assert.equal(room.webSearchEnabled, true);
});

test("setWebSearchEnabled(false) turns it back off", async () => {
  await setWebSearchEnabled(ROOM, false);
  assert.equal(await isWebSearchEnabled(ROOM), false);
});

test("isWebSearchEnabled returns false for an unknown room", async () => {
  assert.equal(await isWebSearchEnabled("does-not-exist-" + nanoid(6)), false);
});
