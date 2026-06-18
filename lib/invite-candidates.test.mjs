import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeAndRankCandidates } from "./invite-candidates.ts";

const pool = [
  { id: "cr_1", email: "jane.doe@illinois.edu", displayName: "Jane Doe", source: "creator" },
  { id: "p:jane.doe@illinois.edu", email: "jane.doe@illinois.edu", displayName: "Jane D", source: "participant" },
  { id: "p:mary.jane@illinois.edu", email: "mary.jane@illinois.edu", displayName: "Mary Jane", source: "participant" },
  { id: "cr_2", email: "bob@illinois.edu", displayName: "Bob Smith", source: "creator" },
];

test("matches on name or email, case-insensitive", () => {
  const r = dedupeAndRankCandidates(pool, "jane", 10);
  const emails = r.map((x) => x.email);
  assert.ok(emails.includes("jane.doe@illinois.edu"));
  assert.ok(emails.includes("mary.jane@illinois.edu"));
  assert.ok(!emails.includes("bob@illinois.edu"));
});

test("dedupes by email, creator wins over participant", () => {
  const r = dedupeAndRankCandidates(pool, "jane", 10);
  const jane = r.filter((x) => x.email === "jane.doe@illinois.edu");
  assert.equal(jane.length, 1);
  assert.equal(jane[0].displayName, "Jane Doe"); // creator name, not "Jane D"
  assert.equal(jane[0].id, "cr_1");
});

test("excludes the requester's own email", () => {
  const r = dedupeAndRankCandidates(pool, "jane", 10, "JANE.DOE@illinois.edu");
  assert.ok(!r.some((x) => x.email === "jane.doe@illinois.edu"));
});

test("ranks name-prefix above name-substring above email-only", () => {
  const p = [
    { id: "a", email: "a@x.edu", displayName: "Zoe Ann", source: "creator" },  // 'an' substring in name
    { id: "b", email: "b@x.edu", displayName: "Ann Lee", source: "creator" },  // 'an' prefix in name
    { id: "c", email: "an@x.edu", displayName: "Carl Ng", source: "creator" }, // 'an' only in email
  ];
  const r = dedupeAndRankCandidates(p, "an", 10);
  assert.deepEqual(r.map((x) => x.id), ["b", "a", "c"]);
});

test("respects the limit", () => {
  assert.equal(dedupeAndRankCandidates(pool, "illinois", 2).length, 2);
});

test("empty or whitespace query returns []", () => {
  assert.deepEqual(dedupeAndRankCandidates(pool, "   ", 10), []);
});
