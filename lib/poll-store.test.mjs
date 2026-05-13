// Run with: PGDATABASE=mindforum_poll_test node --test lib/poll-store.test.mjs
// Setup: createdb mindforum_poll_test; psql -f db/schema.sql
// Node 22+ handles `.ts` imports via strip-types (see lib/admin-sort.test.mjs).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createRoom, upsertParticipant,
  createPoll, castVote, closePoll, closeExpiredPolls,
  getOpenPollsForRoom, getClosedPollsForRoom,
} from "./store.ts";

let ROOM, p1, p2, p3, pollId;

before(async () => {
  const room = await createRoom("test", "admin", "");
  ROOM = room.id;
  p1 = (await upsertParticipant(ROOM, "Alice", "a@x")).id;
  p2 = (await upsertParticipant(ROOM, "Bob", "b@x")).id;
  p3 = (await upsertParticipant(ROOM, "Carol", "c@x")).id;
});

test("create poll with 3 options + 24h expiry", async () => {
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const poll = await createPoll({
    roomId: ROOM, authorId: p1,
    question: "Which approach?",
    options: ["A", "B", "C"],
    closesAt,
  });
  assert.equal(poll.status, "open");
  assert.equal(poll.options.length, 3);
  assert.equal(poll.authorName, "Alice");
  pollId = poll.id;
});

test("3 votes then 1 change → totalVotes stays at 3", async () => {
  const poll = (await getOpenPollsForRoom(ROOM, p1))[0];
  const [oA, oB, oC] = poll.options;
  const r1 = await castVote({ pollId, participantId: p1, optionId: oA.id });
  assert.equal(r1.totalVotes, 1);
  await castVote({ pollId, participantId: p2, optionId: oB.id });
  const r3 = await castVote({ pollId, participantId: p3, optionId: oC.id });
  assert.equal(r3.totalVotes, 3);
  // p3 changes mind
  const r4 = await castVote({ pollId, participantId: p3, optionId: oA.id });
  assert.equal(r4.totalVotes, 3);
});

test("open view hides breakdown but exposes requester's own vote", async () => {
  const [view] = await getOpenPollsForRoom(ROOM, p1);
  assert.equal(view.status, "open");
  assert.equal(view.totalVotes, 3);
  assert.equal(view.myVoteOptionId, view.options[0].id);
  assert.ok(!("tallies" in view), "open view must not include tallies");
});

test("manual close → ClosedPollView with full tallies + winner", async () => {
  const closed = await closePoll({ pollId, closedBy: p1 });
  assert.ok(closed);
  assert.equal(closed.status, "closed");
  assert.equal(closed.totalVotes, 3);
  assert.equal(closed.winnerOptionId, closed.options[0].id);  // 2 votes for A
  assert.equal(closed.inconclusive, false);
});

test("closePoll is idempotent — second call returns null", async () => {
  const again = await closePoll({ pollId, closedBy: p1 });
  assert.equal(again, null);
});

test("closeExpiredPolls only closes polls past closes_at", async () => {
  const future = await createPoll({
    roomId: ROOM, authorId: p1, question: "F", options: ["x", "y"],
    closesAt: new Date(Date.now() + 60_000),
  });
  const past = await createPoll({
    roomId: ROOM, authorId: p1, question: "P", options: ["x", "y"],
    closesAt: new Date(Date.now() - 1_000),
  });
  const closedNow = await closeExpiredPolls(ROOM);
  assert.equal(closedNow.length, 1);
  assert.equal(closedNow[0].id, past.id);
  const again = await closeExpiredPolls(ROOM);
  assert.equal(again.length, 0);
});

test("hidden-tally: vote on open poll, view stays count-only", async () => {
  const poll = await createPoll({
    roomId: ROOM, authorId: p1, question: "Q", options: ["A", "B"],
    closesAt: new Date(Date.now() + 60_000),
  });
  await castVote({ pollId: poll.id, participantId: p1, optionId: poll.options[0].id });
  const view = (await getOpenPollsForRoom(ROOM, p1)).find(v => v.id === poll.id);
  assert.ok(view);
  assert.equal(view.totalVotes, 1);
  assert.equal(view.myVoteOptionId, poll.options[0].id);
  assert.ok(!("tallies" in view));
  assert.ok(!("winnerOptionId" in view));
});

test("concurrent same-participant votes → exactly one final option", async () => {
  const poll = await createPoll({
    roomId: ROOM, authorId: p1, question: "R", options: ["X", "Y", "Z"],
    closesAt: new Date(Date.now() + 60_000),
  });
  const [oX, oY, oZ] = poll.options;
  await Promise.all([
    castVote({ pollId: poll.id, participantId: p2, optionId: oX.id }),
    castVote({ pollId: poll.id, participantId: p2, optionId: oY.id }),
    castVote({ pollId: poll.id, participantId: p2, optionId: oZ.id }),
  ]);
  const view = (await getOpenPollsForRoom(ROOM, p2)).find(v => v.id === poll.id);
  assert.ok(view);
  assert.equal(view.totalVotes, 1, "PK enforces one vote row");
  assert.ok([oX.id, oY.id, oZ.id].includes(view.myVoteOptionId));
});
