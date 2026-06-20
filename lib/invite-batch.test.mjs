import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInviteBatch } from "./invite-batch.ts";

test("keeps valid entries and trims fields", () => {
  const out = parseInviteBatch({
    invites: [{ inviteeEmail: "  a@x.edu ", inviteeName: "  Ann  " }],
  });
  assert.deepEqual(out, [{ inviteeEmail: "a@x.edu", inviteeName: "Ann" }]);
});

test("drops entries missing email-shape or name", () => {
  const out = parseInviteBatch({
    invites: [
      { inviteeEmail: "no-at-sign", inviteeName: "Bo" },
      { inviteeEmail: "c@x.edu", inviteeName: "   " },
      { inviteeEmail: "d@x.edu", inviteeName: "Dee" },
    ],
  });
  assert.deepEqual(out, [{ inviteeEmail: "d@x.edu", inviteeName: "Dee" }]);
});

test("collapses case-insensitive duplicate emails, first wins", () => {
  const out = parseInviteBatch({
    invites: [
      { inviteeEmail: "E@x.edu", inviteeName: "First" },
      { inviteeEmail: "e@x.edu", inviteeName: "Second" },
    ],
  });
  assert.deepEqual(out, [{ inviteeEmail: "E@x.edu", inviteeName: "First" }]);
});

test("caps at 50 entries", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    inviteeEmail: `u${i}@x.edu`,
    inviteeName: `U${i}`,
  }));
  assert.equal(parseInviteBatch({ invites: many }).length, 50);
});

test("returns [] for non-array or missing invites", () => {
  assert.deepEqual(parseInviteBatch({}), []);
  assert.deepEqual(parseInviteBatch({ invites: "nope" }), []);
  assert.deepEqual(parseInviteBatch(null), []);
});
