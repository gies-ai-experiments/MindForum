import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshot } from "./store.ts";

function makeRoom(participants) {
  return {
    id: "r1",
    name: "Room",
    systemPrompt: "",
    webSearchEnabled: false,
    archivedAt: null,
    participants,
    messages: [],
    files: [],
  };
}

const P = (id, lastSeenAt) => ({
  id,
  name: id.toUpperCase(),
  email: `${id}@x`,
  joinedAt: 1,
  lastSeenAt,
  mutedAt: null,
  removedAt: null,
});

test("snapshot marks participants in the online set", () => {
  const snap = snapshot(
    makeRoom([P("a", null), P("b", 5)]),
    undefined,
    [],
    [],
    [],
    new Set(["a"]),
  );
  const byId = Object.fromEntries(snap.participants.map((p) => [p.id, p]));
  assert.equal(byId.a.online, true);
  assert.equal(byId.b.online, false);
  assert.equal(byId.b.lastSeenAt, 5); // lastSeenAt is preserved for the client
});

test("snapshot defaults everyone offline when no online set is passed", () => {
  const snap = snapshot(makeRoom([P("a", null)]));
  assert.equal(snap.participants[0].online, false);
});
