# Polls & Decisions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/poll` command that lets any participant launch a single-choice, hidden-tally vote in a MindForum room; surface every closed poll automatically in the project brief's new `Decisions & Votes` section.

**Architecture:** Three Postgres tables (`polls`, `poll_options`, `poll_votes`) with a one-row-per-vote UPSERT model and lazy server-side expiry (no scheduler). Four new `POST` routes under `/api/room/[id]/poll/...` plus three new SSE event types. Two LLM call sites: drafting options at launch (json_schema strict), and echoing tallies into `Brief.decisions[]` at brief-generation time (post-validated against DB).

**Tech Stack:** Next.js 15 App Router · Postgres (`pg`) · SSE in-memory pub/sub · OpenAI structured outputs (json_schema strict) · React 19 · TextareaAutosize · node test runner (no framework lock-in).

**Design source:** `docs/plans/2026-05-13-polls-and-decisions-design.md`

**Pre-flight gotchas to internalize** (from `mindforum/CLAUDE.md` and prior session logs):
- AI streaming reuses `updateMessageContent` without setting `edited_at` — do **not** confuse poll-close timestamps with chat-edit semantics.
- `next start` doesn't read PORT from `.env.local`. PM2 entry already bakes it in; do not touch.
- `npm install` dirties `package-lock.json` on VPS; the deploy script handles this. Don't worry about it locally.
- **Migration version is v6.** Creator-rooms-v1 branch reserved v6/v7/v8 but is being ignored per design decision. If creator-rooms-v1 ever merges first, renumber this migration. Flag at merge time.
- Don't write synthetic rows into `participants` for any non-membership purpose — caught on 2026-05-06. Poll authorship uses `participants.id` directly; no synthetic identities.
- SSE is in-memory per-process. A mid-stream restart drops live subscribers but DB state is consistent — clients reconnecting after see the right state.

---

## Task 1: Schema migration v6 — three poll tables

**Files:**
- Modify: `db/schema.sql` (append at end)

**Step 1: Append migration v6 to schema.sql**

```sql

-- v6: polls — single-choice voting with hidden tallies until close.
-- One row per vote (UPSERT on conflict = change vote, no history).
-- Lazy expiry: status='open' is canonically open iff closes_at IS NULL OR closes_at > NOW().
CREATE TABLE IF NOT EXISTS polls (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL,
  question     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open','closed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at    TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  closed_by    TEXT
);

CREATE INDEX IF NOT EXISTS polls_room_status_idx
  ON polls (room_id, status);

CREATE TABLE IF NOT EXISTS poll_options (
  id        TEXT PRIMARY KEY,
  poll_id   TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL,
  UNIQUE (poll_id, position)
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id        TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  option_id      TEXT NOT NULL REFERENCES poll_options(id),
  cast_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, participant_id)
);

INSERT INTO schema_migrations (version) VALUES (6)
  ON CONFLICT (version) DO NOTHING;
```

**Step 2: Run migration locally against a throwaway DB**

```bash
createdb mindforum_migrate_test 2>/dev/null || true
PGDATABASE=mindforum_migrate_test psql -f db/schema.sql
PGDATABASE=mindforum_migrate_test psql -c "\dt polls poll_options poll_votes"
PGDATABASE=mindforum_migrate_test psql -c "SELECT version FROM schema_migrations ORDER BY version"
```

Expected: three tables listed, versions `1,2,3,4,5,6`.

**Step 3: Verify rerun safety**

```bash
PGDATABASE=mindforum_migrate_test psql -f db/schema.sql
```

Expected: no errors, `INSERT 0 0` for version 6 row, table creation messages all `NOTICE: relation already exists, skipping`.

**Step 4: Drop the test DB**

```bash
dropdb mindforum_migrate_test
```

**Step 5: Commit**

```bash
git add db/schema.sql
git commit -m "feat(db): migration v6 — polls, poll_options, poll_votes"
```

---

## Task 2: Domain types in store.ts

**Files:**
- Modify: `lib/store.ts` — add types near the existing `Message`/`Room` type block (around line 54).

**Step 1: Add types**

After the existing `Room` type, add:

```ts
export type Poll = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;          // hydrated from participants
  question: string;
  status: "open" | "closed";
  createdAt: number;
  closesAt: number | null;
  closedAt: number | null;
  closedBy: string | null;     // participant id | 'auto'
  options: PollOption[];
};

export type PollOption = {
  id: string;
  pollId: string;
  position: number;
  text: string;
};

export type PollVote = {
  pollId: string;
  participantId: string;
  optionId: string;
  castAt: number;
};

// Hidden-tally view sent to clients while a poll is open.
export type OpenPollView = Omit<Poll, "status"> & {
  status: "open";
  totalVotes: number;
  myVoteOptionId: string | null;   // requester's own vote
};

// Full-breakdown view sent once a poll is closed.
export type ClosedPollView = Omit<Poll, "status"> & {
  status: "closed";
  totalVotes: number;
  tallies: { optionId: string; text: string; votes: number }[];
  winnerOptionId: string | null;   // null when tied or no votes
  inconclusive: boolean;           // totalVotes < 2 OR top-two tied
};
```

**Step 2: Commit**

```bash
git add lib/store.ts
git commit -m "feat(types): add Poll/PollOption/PollVote/OpenPollView/ClosedPollView"
```

---

## Task 3: Pure logic module (winner + validation) with tests

**Files:**
- Create: `lib/poll-logic.ts`
- Create: `lib/poll-logic.test.mjs`

**Step 1: Write the failing tests**

Create `lib/poll-logic.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTallies,
  validateOptions,
  isExpired,
} from "./poll-logic.js";

test("computeTallies — clear winner", () => {
  const options = [
    { id: "po_a", position: 0, text: "A" },
    { id: "po_b", position: 1, text: "B" },
    { id: "po_c", position: 2, text: "C" },
  ];
  const votes = [
    { optionId: "po_a" }, { optionId: "po_a" }, { optionId: "po_a" },
    { optionId: "po_b" },
  ];
  const r = computeTallies(options, votes);
  assert.equal(r.totalVotes, 4);
  assert.equal(r.winnerOptionId, "po_a");
  assert.equal(r.inconclusive, false);
  assert.deepEqual(
    r.tallies.map(t => [t.optionId, t.votes]),
    [["po_a", 3], ["po_b", 1], ["po_c", 0]],
  );
});

test("computeTallies — two-way tie at top is inconclusive", () => {
  const options = [
    { id: "po_a", position: 0, text: "A" },
    { id: "po_b", position: 1, text: "B" },
  ];
  const votes = [{ optionId: "po_a" }, { optionId: "po_b" }];
  const r = computeTallies(options, votes);
  assert.equal(r.totalVotes, 2);
  assert.equal(r.winnerOptionId, null);
  assert.equal(r.inconclusive, true);
});

test("computeTallies — single voter is inconclusive (totalVotes < 2)", () => {
  const options = [
    { id: "po_a", position: 0, text: "A" },
    { id: "po_b", position: 1, text: "B" },
  ];
  const votes = [{ optionId: "po_a" }];
  const r = computeTallies(options, votes);
  assert.equal(r.totalVotes, 1);
  assert.equal(r.winnerOptionId, "po_a");
  assert.equal(r.inconclusive, true);
});

test("computeTallies — zero votes", () => {
  const options = [{ id: "po_a", position: 0, text: "A" }];
  const r = computeTallies(options, []);
  assert.equal(r.totalVotes, 0);
  assert.equal(r.winnerOptionId, null);
  assert.equal(r.inconclusive, true);
});

test("validateOptions — accepts 2-5 unique non-empty", () => {
  assert.deepEqual(validateOptions(["A", "B"]), { ok: true, normalized: ["A", "B"] });
  assert.deepEqual(
    validateOptions(["A", "B", "C", "D", "E"]),
    { ok: true, normalized: ["A", "B", "C", "D", "E"] },
  );
});

test("validateOptions — trims, drops empty", () => {
  assert.deepEqual(
    validateOptions(["  A  ", "", "B", "   "]),
    { ok: true, normalized: ["A", "B"] },
  );
});

test("validateOptions — rejects <2", () => {
  assert.deepEqual(validateOptions(["A"]), { ok: false, error: "min_options" });
  assert.deepEqual(validateOptions([""]), { ok: false, error: "min_options" });
});

test("validateOptions — rejects >5", () => {
  assert.deepEqual(
    validateOptions(["A", "B", "C", "D", "E", "F"]),
    { ok: false, error: "max_options" },
  );
});

test("validateOptions — rejects case-insensitive duplicates", () => {
  assert.deepEqual(
    validateOptions(["Apple", "apple"]),
    { ok: false, error: "duplicate_options" },
  );
});

test("isExpired — open + past closes_at → true", () => {
  assert.equal(isExpired({ status: "open", closesAt: Date.now() - 1 }), true);
});

test("isExpired — open + future closes_at → false", () => {
  assert.equal(isExpired({ status: "open", closesAt: Date.now() + 60_000 }), false);
});

test("isExpired — manual (closesAt null) → false", () => {
  assert.equal(isExpired({ status: "open", closesAt: null }), false);
});

test("isExpired — already closed → false (idempotent)", () => {
  assert.equal(isExpired({ status: "closed", closesAt: Date.now() - 1 }), false);
});
```

**Step 2: Run tests to verify they fail**

```bash
node --test lib/poll-logic.test.mjs
```

Expected: all tests fail with `Cannot find module './poll-logic.js'`.

**Step 3: Implement `lib/poll-logic.ts`**

```ts
export type OptionRow = { id: string; position: number; text: string };
export type VoteRow = { optionId: string };

export type TallyResult = {
  totalVotes: number;
  tallies: { optionId: string; text: string; votes: number }[];
  winnerOptionId: string | null;
  inconclusive: boolean;
};

export function computeTallies(options: OptionRow[], votes: VoteRow[]): TallyResult {
  const counts = new Map<string, number>();
  for (const o of options) counts.set(o.id, 0);
  for (const v of votes) counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);

  const tallies = options
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(o => ({ optionId: o.id, text: o.text, votes: counts.get(o.id) ?? 0 }));

  const totalVotes = votes.length;

  const sortedByVotes = tallies.slice().sort((a, b) => b.votes - a.votes);
  const top = sortedByVotes[0];
  const second = sortedByVotes[1];

  const tied = top && second && top.votes === second.votes && top.votes > 0;
  const winnerOptionId = !tied && top && top.votes > 0 ? top.optionId : null;
  const inconclusive = totalVotes < 2 || !!tied;

  return { totalVotes, tallies, winnerOptionId, inconclusive };
}

export type ValidateResult =
  | { ok: true; normalized: string[] }
  | { ok: false; error: "min_options" | "max_options" | "duplicate_options" };

export function validateOptions(raw: string[]): ValidateResult {
  const normalized = raw.map(s => s.trim()).filter(s => s.length > 0);
  if (normalized.length < 2) return { ok: false, error: "min_options" };
  if (normalized.length > 5) return { ok: false, error: "max_options" };
  const seen = new Set<string>();
  for (const s of normalized) {
    const k = s.toLowerCase();
    if (seen.has(k)) return { ok: false, error: "duplicate_options" };
    seen.add(k);
  }
  return { ok: true, normalized };
}

export function isExpired(p: { status: "open" | "closed"; closesAt: number | null }): boolean {
  if (p.status !== "open") return false;
  if (p.closesAt == null) return false;
  return p.closesAt <= Date.now();
}
```

**Step 4: Run tests to verify they pass**

```bash
node --test lib/poll-logic.test.mjs
```

Expected: 12 passing tests, 0 failures.

**Step 5: Commit**

```bash
git add lib/poll-logic.ts lib/poll-logic.test.mjs
git commit -m "feat(poll-logic): pure functions for tallies/validation/expiry + tests"
```

---

## Task 4: Store CRUD — `createPoll`, `getPoll`, `getOpenPollsForRoom`, `getClosedPollsForRoom`

**Files:**
- Modify: `lib/store.ts` — append a `// -------- Polls` section at the end.

**Step 1: Add imports + helpers**

At the bottom of `lib/store.ts`, append:

```ts
// -------- Polls
import { computeTallies, type OptionRow, type VoteRow } from "./poll-logic";

function shortId(prefix: string): string {
  // 8 hex chars from crypto.randomUUID is plenty for room-scoped IDs
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function toPoll(row: {
  id: string;
  room_id: string;
  author_id: string;
  author_name: string;
  question: string;
  status: string;
  created_at: Date;
  closes_at: Date | null;
  closed_at: Date | null;
  closed_by: string | null;
}, options: PollOption[]): Poll {
  return {
    id: row.id,
    roomId: row.room_id,
    authorId: row.author_id,
    authorName: row.author_name,
    question: row.question,
    status: row.status as "open" | "closed",
    createdAt: row.created_at.getTime(),
    closesAt: row.closes_at ? row.closes_at.getTime() : null,
    closedAt: row.closed_at ? row.closed_at.getTime() : null,
    closedBy: row.closed_by,
    options,
  };
}

export async function createPoll(input: {
  roomId: string;
  authorId: string;
  question: string;
  options: string[];          // pre-validated
  closesAt: Date | null;
}): Promise<Poll> {
  const pollId = shortId("pl");
  return sql.tx(async (tx) => {
    const pollRow = await tx.one(
      `INSERT INTO polls (id, room_id, author_id, question, status, closes_at)
       VALUES ($1, $2, $3, $4, 'open', $5)
       RETURNING *`,
      [pollId, input.roomId, input.authorId, input.question, input.closesAt],
    );
    const optionRows = [];
    for (let i = 0; i < input.options.length; i++) {
      const optionId = shortId("po");
      optionRows.push(await tx.one(
        `INSERT INTO poll_options (id, poll_id, position, text)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [optionId, pollId, i, input.options[i]],
      ));
    }
    // Hydrate author_name
    const author = await tx.one(
      `SELECT name FROM participants WHERE id = $1 AND room_id = $2`,
      [input.authorId, input.roomId],
    );
    return toPoll(
      { ...pollRow, author_name: author.name },
      optionRows.map(r => ({ id: r.id, pollId: r.poll_id, position: r.position, text: r.text })),
    );
  });
}

export async function getPoll(pollId: string): Promise<Poll | null> {
  const pollRow = await sql.oneOrNone(
    `SELECT p.*, COALESCE(pt.name, '(unknown)') AS author_name
     FROM polls p
     LEFT JOIN participants pt ON pt.id = p.author_id AND pt.room_id = p.room_id
     WHERE p.id = $1`,
    [pollId],
  );
  if (!pollRow) return null;
  const optionRows = await sql.any(
    `SELECT * FROM poll_options WHERE poll_id = $1 ORDER BY position`,
    [pollId],
  );
  return toPoll(pollRow, optionRows.map(r => ({
    id: r.id, pollId: r.poll_id, position: r.position, text: r.text,
  })));
}

export async function getOpenPollsForRoom(
  roomId: string,
  requesterId: string,
): Promise<OpenPollView[]> {
  const polls = await sql.any(
    `SELECT p.*, COALESCE(pt.name, '(unknown)') AS author_name
     FROM polls p
     LEFT JOIN participants pt ON pt.id = p.author_id AND pt.room_id = p.room_id
     WHERE p.room_id = $1 AND p.status = 'open'
     ORDER BY p.created_at`,
    [roomId],
  );
  const views: OpenPollView[] = [];
  for (const p of polls) {
    const opts = await sql.any(
      `SELECT * FROM poll_options WHERE poll_id = $1 ORDER BY position`,
      [p.id],
    );
    const totalVotes = (await sql.one(
      `SELECT COUNT(*)::int AS n FROM poll_votes WHERE poll_id = $1`,
      [p.id],
    )).n;
    const my = await sql.oneOrNone(
      `SELECT option_id FROM poll_votes WHERE poll_id = $1 AND participant_id = $2`,
      [p.id, requesterId],
    );
    const base = toPoll(p, opts.map(r => ({
      id: r.id, pollId: r.poll_id, position: r.position, text: r.text,
    })));
    views.push({
      ...base,
      status: "open",
      totalVotes,
      myVoteOptionId: my?.option_id ?? null,
    });
  }
  return views;
}

export async function getClosedPollsForRoom(
  roomId: string,
  limit = 50,
): Promise<ClosedPollView[]> {
  const polls = await sql.any(
    `SELECT p.*, COALESCE(pt.name, '(unknown)') AS author_name
     FROM polls p
     LEFT JOIN participants pt ON pt.id = p.author_id AND pt.room_id = p.room_id
     WHERE p.room_id = $1 AND p.status = 'closed'
     ORDER BY p.closed_at DESC
     LIMIT $2`,
    [roomId, limit],
  );
  const views: ClosedPollView[] = [];
  for (const p of polls) {
    const opts = await sql.any(
      `SELECT * FROM poll_options WHERE poll_id = $1 ORDER BY position`,
      [p.id],
    );
    const votes = await sql.any(
      `SELECT option_id FROM poll_votes WHERE poll_id = $1`,
      [p.id],
    );
    const tally = computeTallies(
      opts.map((o): OptionRow => ({ id: o.id, position: o.position, text: o.text })),
      votes.map((v): VoteRow => ({ optionId: v.option_id })),
    );
    const base = toPoll(p, opts.map(r => ({
      id: r.id, pollId: r.poll_id, position: r.position, text: r.text,
    })));
    views.push({
      ...base,
      status: "closed",
      totalVotes: tally.totalVotes,
      tallies: tally.tallies,
      winnerOptionId: tally.winnerOptionId,
      inconclusive: tally.inconclusive,
    });
  }
  return views.reverse();   // newest-last for chat-stream alignment
}
```

> **Note:** Match the existing `pg-promise` (or whatever wrapper `lib/db.ts` exposes) call shape — `sql.tx`/`sql.one`/`sql.any`/`sql.oneOrNone`. Read `lib/db.ts` once before writing; adapt the verbs if the wrapper differs.

**Step 2: Commit**

```bash
git add lib/store.ts
git commit -m "feat(store): createPoll, getPoll, getOpenPollsForRoom, getClosedPollsForRoom"
```

---

## Task 5: Store CRUD — `castVote`, `closePoll`, `closeExpiredPolls`

**Files:**
- Modify: `lib/store.ts` — continue the polls section.

**Step 1: Add functions**

```ts
export async function castVote(input: {
  pollId: string;
  participantId: string;
  optionId: string;
}): Promise<{ totalVotes: number }> {
  return sql.tx(async (tx) => {
    // Guard: poll must exist AND be open AND option must belong to poll.
    const open = await tx.oneOrNone(
      `SELECT 1 FROM polls
       WHERE id = $1 AND status = 'open'
         AND (closes_at IS NULL OR closes_at > NOW())`,
      [input.pollId],
    );
    if (!open) throw new Error("poll_not_open");
    const optOk = await tx.oneOrNone(
      `SELECT 1 FROM poll_options WHERE id = $1 AND poll_id = $2`,
      [input.optionId, input.pollId],
    );
    if (!optOk) throw new Error("invalid_option");
    await tx.none(
      `INSERT INTO poll_votes (poll_id, participant_id, option_id, cast_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (poll_id, participant_id)
       DO UPDATE SET option_id = EXCLUDED.option_id, cast_at = NOW()`,
      [input.pollId, input.participantId, input.optionId],
    );
    const { n } = await tx.one(
      `SELECT COUNT(*)::int AS n FROM poll_votes WHERE poll_id = $1`,
      [input.pollId],
    );
    return { totalVotes: n };
  });
}

export async function closePoll(input: {
  pollId: string;
  closedBy: string;          // participant id or 'auto'
}): Promise<ClosedPollView | null> {
  const row = await sql.oneOrNone(
    `UPDATE polls
     SET status='closed', closed_at=NOW(), closed_by=$2
     WHERE id=$1 AND status='open'
     RETURNING room_id`,
    [input.pollId, input.closedBy],
  );
  if (!row) return null;       // already closed (idempotent) or doesn't exist
  // Re-fetch via the closed-list helper for a consistent view.
  const closed = await getClosedPollsForRoom(row.room_id, 100);
  return closed.find(p => p.id === input.pollId) ?? null;
}

/**
 * Lazy expiry: closes all polls in a room whose closes_at has passed.
 * Returns the ClosedPollView for each newly-closed poll so the caller can
 * broadcast `poll_closed` events.
 *
 * Idempotent: the `WHERE status='open'` guard prevents double-close.
 */
export async function closeExpiredPolls(roomId: string): Promise<ClosedPollView[]> {
  const rows = await sql.any(
    `UPDATE polls
     SET status='closed', closed_at=NOW(), closed_by='auto'
     WHERE room_id=$1
       AND status='open'
       AND closes_at IS NOT NULL
       AND closes_at <= NOW()
     RETURNING id`,
    [roomId],
  );
  if (rows.length === 0) return [];
  const closed = await getClosedPollsForRoom(roomId, 100);
  const closedIds = new Set(rows.map((r: { id: string }) => r.id));
  return closed.filter(p => closedIds.has(p.id));
}
```

**Step 2: Commit**

```bash
git add lib/store.ts
git commit -m "feat(store): castVote (UPSERT), closePoll, closeExpiredPolls (lazy)"
```

---

## Task 6: Integration test — full poll lifecycle against a throwaway DB

**Files:**
- Create: `lib/poll-store.test.mjs`

**Step 1: Write the test**

```js
// Run with: PGDATABASE=mindforum_poll_test node --test lib/poll-store.test.mjs
// Setup: createdb mindforum_poll_test; psql -f db/schema.sql
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createRoom, upsertParticipant,
  createPoll, castVote, closePoll, closeExpiredPolls,
  getOpenPollsForRoom, getClosedPollsForRoom,
} from "./store.js";

const ROOM = `test-poll-${Date.now()}`;
let p1, p2, p3, pollId;

before(async () => {
  await createRoom({
    id: ROOM, name: "test", createdById: "admin", systemPrompt: "",
  });
  p1 = (await upsertParticipant({ roomId: ROOM, name: "Alice", email: "a@x" })).id;
  p2 = (await upsertParticipant({ roomId: ROOM, name: "Bob", email: "b@x" })).id;
  p3 = (await upsertParticipant({ roomId: ROOM, name: "Carol", email: "c@x" })).id;
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
  // Future poll
  const future = await createPoll({
    roomId: ROOM, authorId: p1, question: "F", options: ["x", "y"],
    closesAt: new Date(Date.now() + 60_000),
  });
  // Past poll
  const past = await createPoll({
    roomId: ROOM, authorId: p1, question: "P", options: ["x", "y"],
    closesAt: new Date(Date.now() - 1_000),
  });
  const closedNow = await closeExpiredPolls(ROOM);
  assert.equal(closedNow.length, 1);
  assert.equal(closedNow[0].id, past.id);
  // Idempotent re-run
  const again = await closeExpiredPolls(ROOM);
  assert.equal(again.length, 0);
});

after(async () => {
  // Leave the DB intact; user drops it manually.
});
```

**Step 2: Run setup + tests**

```bash
createdb mindforum_poll_test 2>/dev/null || true
PGDATABASE=mindforum_poll_test psql -f db/schema.sql > /dev/null
PGDATABASE=mindforum_poll_test node --test lib/poll-store.test.mjs
```

Expected: 6 passing tests.

**Step 3: Drop test DB**

```bash
dropdb mindforum_poll_test
```

**Step 4: Commit**

```bash
git add lib/poll-store.test.mjs
git commit -m "test(store): full poll lifecycle + UPSERT + lazy-close idempotency"
```

---

## Task 7: AI drafter in `lib/openai.ts`

**Files:**
- Modify: `lib/openai.ts` — add after `generateBrief`.

**Step 1: Add `draftPollFromHistory`**

```ts
export type PollDraft = {
  question: string;
  options: string[];   // 0..5; empty array signals "no convergeable question"
};

const POLL_DRAFT_SYSTEM = `You help a MindForum room run a quick vote. Read the recent conversation and propose ONE decision-point that participants are implicitly debating. Output a single question and 2 to 5 mutually exclusive options grounded in what participants actually said. Do NOT invent options the group didn't discuss. If the conversation has no convergeable decision yet, return options: [].`;

export async function draftPollFromHistory(
  recentMessages: Message[],
): Promise<PollDraft> {
  const res = await client().chat.completions.create({
    model: MODEL_BRIEF,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "PollDraft",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            options: {
              type: "array",
              minItems: 0,
              maxItems: 5,
              items: { type: "string" },
            },
          },
          required: ["question", "options"],
        },
      },
    },
    messages: [
      { role: "system", content: POLL_DRAFT_SYSTEM },
      ...historyBlock(recentMessages),
    ],
  });
  const raw = res.choices[0]?.message?.content ?? `{"question":"","options":[]}`;
  try {
    return JSON.parse(raw) as PollDraft;
  } catch {
    return { question: "", options: [] };
  }
}
```

**Step 2: Commit**

```bash
git add lib/openai.ts
git commit -m "feat(openai): draftPollFromHistory — json_schema strict, empty-options fallback"
```

---

## Task 8: Rate-limit keys

**Files:**
- No code changes — `checkRate` already supports arbitrary bucket strings. Just document the new keys.

**Step 1: Add a comment block in `lib/ratelimit.ts`**

After line 3 (the existing comment), append:

```ts
// Known buckets:
//   create-room       5  / 10min
//   join              10 /  1min
//   message           60 /  1min
//   upload            10 / 10min
//   brief             3  /  5min
//   poll-draft        5  /  5min   ← new
//   poll-create       5  / 10min   ← new
//   poll-vote         30 /  1min   ← new
//   poll-close        10 /  1min   ← new
```

**Step 2: Commit**

```bash
git add lib/ratelimit.ts
git commit -m "docs(ratelimit): document poll-* bucket limits"
```

---

## Task 9: Route — `POST /api/room/[id]/poll/draft`

**Files:**
- Create: `app/api/room/[id]/poll/draft/route.ts`

**Step 1: Implement**

```ts
import { NextRequest } from "next/server";
import { getRoom } from "@/lib/store";
import { draftPollFromHistory } from "@/lib/openai";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { requireRoomParticipant } from "@/lib/auth-helpers";  // see Task 9a

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rate = checkRate("poll-draft", clientIp(req), 5, 5 * 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  const room = await getRoom(id);
  if (!room) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });

  // Last ~20 chat messages (skip AI, brief, poll kinds for cleaner extraction).
  const recent = room.messages
    .filter(m => !m.kind || m.kind === "chat")
    .slice(-20);

  try {
    const draft = await draftPollFromHistory(recent);
    return Response.json(draft);
  } catch (e) {
    // Degrade gracefully — UI falls back to blank form.
    return Response.json({ question: "", options: [] });
  }
}
```

**Step 2: Commit**

```bash
git add app/api/room/[id]/poll/draft/route.ts
git commit -m "feat(api): POST /poll/draft — AI option extraction"
```

---

## Task 9a: Auth helper — `requireRoomParticipant`

**Files:**
- Create: `lib/auth-helpers.ts` (or fold into an existing helpers file if one exists — read `app/api/room/[id]/message/route.ts` first to mirror its existing auth pattern).

**Step 1: Inspect existing pattern**

```bash
grep -n "mindforum_pid\|cookie" app/api/room/[id]/message/route.ts | head -20
```

If `/message` already has an inline auth block, **extract it** into `lib/auth-helpers.ts`:

```ts
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "./db";

export type AuthResult =
  | { ok: true; participantId: string; participantName: string }
  | { ok: false; response: Response };

export async function requireRoomParticipant(
  _req: NextRequest,
  roomId: string,
): Promise<AuthResult> {
  const jar = await cookies();
  const pid = jar.get(`mindforum_pid_${roomId}`)?.value;
  if (!pid) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "not_joined" }), { status: 401 }),
    };
  }
  const row = await sql.oneOrNone(
    `SELECT id, name FROM participants WHERE id = $1 AND room_id = $2`,
    [pid, roomId],
  );
  if (!row) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "not_joined" }), { status: 401 }),
    };
  }
  return { ok: true, participantId: row.id, participantName: row.name };
}

export function isAdmin(): boolean {
  // Mirror existing ADMIN_TOKEN check pattern from app/api/admin/seed/route.ts
  return false;   // TODO: implement after inspecting admin-auth.ts
}
```

Then refactor `/message`, `/join`, `/upload`, etc. to call it (one route per task if you want; or fold into Task 9a if cheap). **Do not skip this** — duplicating auth blocks across new poll routes is a smell.

**Step 2: Run any existing route tests that touch auth**

```bash
grep -rln "test" app/api lib | grep -v node_modules
```

Verify nothing broke.

**Step 3: Commit**

```bash
git add lib/auth-helpers.ts app/api/room/[id]/{message,join,upload}/route.ts
git commit -m "refactor(auth): extract requireRoomParticipant helper"
```

---

## Task 10: Route — `POST /api/room/[id]/poll`

**Files:**
- Create: `app/api/room/[id]/poll/route.ts`

**Step 1: Implement**

```ts
import { NextRequest } from "next/server";
import { createPoll } from "@/lib/store";
import { validateOptions } from "@/lib/poll-logic";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

const DURATION_MS: Record<string, number | null> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "manual": null,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rate = checkRate("poll-create", clientIp(req), 5, 10 * 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  let body: { question?: unknown; options?: unknown; duration?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ error: "bad_json" }, { status: 400 }); }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: "empty_question" }, { status: 400 });

  const rawOptions = Array.isArray(body.options) ? body.options.map(String) : [];
  const v = validateOptions(rawOptions);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });

  const duration = typeof body.duration === "string" ? body.duration : "1h";
  if (!(duration in DURATION_MS)) {
    return Response.json({ error: "bad_duration" }, { status: 400 });
  }
  const ms = DURATION_MS[duration];
  const closesAt = ms == null ? null : new Date(Date.now() + ms);

  const poll = await createPoll({
    roomId: id,
    authorId: auth.participantId,
    question,
    options: v.normalized,
    closesAt,
  });

  broadcast(id, "poll_opened", {
    pollId: poll.id,
    question: poll.question,
    options: poll.options,
    closesAt: poll.closesAt,
    authorId: poll.authorId,
    authorName: poll.authorName,
  });

  return Response.json(poll);
}
```

**Step 2: Commit**

```bash
git add app/api/room/[id]/poll/route.ts
git commit -m "feat(api): POST /poll — launch poll, broadcast poll_opened"
```

---

## Task 11: Route — `POST /api/room/[id]/poll/[pollId]/vote`

**Files:**
- Create: `app/api/room/[id]/poll/[pollId]/vote/route.ts`

**Step 1: Implement**

```ts
import { NextRequest } from "next/server";
import { castVote, closeExpiredPolls } from "@/lib/store";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { requireRoomParticipant } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pollId: string }> },
) {
  const { id, pollId } = await params;
  const rate = checkRate("poll-vote", clientIp(req), 30, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  // Lazy-close first — voter might be trying to vote on an expired poll.
  const newlyClosed = await closeExpiredPolls(id);
  for (const c of newlyClosed) {
    broadcast(id, "poll_closed", c);
  }

  const body = await req.json().catch(() => ({}));
  const optionId = typeof body.optionId === "string" ? body.optionId : "";
  if (!optionId) return Response.json({ error: "missing_option" }, { status: 400 });

  try {
    const { totalVotes } = await castVote({
      pollId,
      participantId: auth.participantId,
      optionId,
    });
    broadcast(id, "poll_vote", { pollId, totalVotes });
    return Response.json({ totalVotes });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "poll_not_open") {
      const closed = newlyClosed.find(p => p.id === pollId);
      return Response.json({ error: "poll_closed", closed }, { status: 409 });
    }
    if (msg === "invalid_option") {
      return Response.json({ error: "invalid_option" }, { status: 400 });
    }
    throw e;
  }
}
```

**Step 2: Commit**

```bash
git add app/api/room/[id]/poll/[pollId]/vote/route.ts
git commit -m "feat(api): POST /poll/:pollId/vote — UPSERT, broadcast total-only"
```

---

## Task 12: Route — `POST /api/room/[id]/poll/[pollId]/close`

**Files:**
- Create: `app/api/room/[id]/poll/[pollId]/close/route.ts`

**Step 1: Implement**

```ts
import { NextRequest } from "next/server";
import { closePoll, getPoll } from "@/lib/store";
import { checkRate, clientIp, rateLimited } from "@/lib/ratelimit";
import { requireRoomParticipant, isAdmin } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pollId: string }> },
) {
  const { id, pollId } = await params;
  const rate = checkRate("poll-close", clientIp(req), 10, 60 * 1000);
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const auth = await requireRoomParticipant(req, id);
  if (!auth.ok) return auth.response;

  const poll = await getPoll(pollId);
  if (!poll || poll.roomId !== id) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const canClose = poll.authorId === auth.participantId || isAdmin();
  if (!canClose) return Response.json({ error: "forbidden" }, { status: 403 });

  const closed = await closePoll({ pollId, closedBy: auth.participantId });
  if (!closed) {
    // Already closed — idempotent. Return current view.
    const fresh = await getPoll(pollId);
    return Response.json({ alreadyClosed: true, poll: fresh });
  }
  broadcast(id, "poll_closed", closed);
  return Response.json(closed);
}
```

**Step 2: Commit**

```bash
git add app/api/room/[id]/poll/[pollId]/close/route.ts
git commit -m "feat(api): POST /poll/:pollId/close — author/admin only, idempotent"
```

---

## Task 13: Wire `closeExpiredPolls` into existing read/message routes

**Files:**
- Modify: `app/api/room/[id]/route.ts` (if it exists for GET — otherwise the stream/state endpoint that hydrates room state)
- Modify: `app/api/room/[id]/message/route.ts`

**Step 1: Find the canonical "read room state" handler**

```bash
grep -rln "getRoom(" app/api lib | grep -v node_modules
```

In each route that calls `getRoom(id)` and returns it to the client (typically `GET` and the message route's response), add at the top of the handler (after auth, before `getRoom`):

```ts
import { closeExpiredPolls, getOpenPollsForRoom, getClosedPollsForRoom } from "@/lib/store";
import { broadcast } from "@/lib/sse";

// ...
const newlyClosed = await closeExpiredPolls(id);
for (const c of newlyClosed) broadcast(id, "poll_closed", c);
```

**Step 2: Extend the room-state response shape**

Wherever the room JSON is returned, attach:

```ts
const openPolls = await getOpenPollsForRoom(id, auth.participantId);
const recentClosedPolls = await getClosedPollsForRoom(id, 10);
return Response.json({ ...room, openPolls, recentClosedPolls });
```

**Step 3: Commit**

```bash
git add app/api/room/[id]/route.ts app/api/room/[id]/message/route.ts
git commit -m "feat(api): wire closeExpiredPolls + openPolls/recentClosedPolls into room state"
```

---

## Task 14: Integration test — hidden-tally enforcement + race

**Files:**
- Modify: `lib/poll-store.test.mjs` (append)

**Step 1: Add two more tests**

```js
test("hidden-tally: open view returns totalVotes only, never per-option breakdown", async () => {
  // (re-setup or reuse from earlier tests; pseudo-shown)
  const poll = await createPoll({
    roomId: ROOM, authorId: p1, question: "Q", options: ["A","B"],
    closesAt: new Date(Date.now() + 60_000),
  });
  await castVote({ pollId: poll.id, participantId: p1, optionId: poll.options[0].id });
  const [view] = (await getOpenPollsForRoom(ROOM, p1)).filter(v => v.id === poll.id);
  assert.equal(view.totalVotes, 1);
  assert.equal(view.myVoteOptionId, poll.options[0].id);
  // Critical: no `tallies` field on OpenPollView.
  assert.ok(!("tallies" in view));
  assert.ok(!("winnerOptionId" in view));
});

test("concurrent same-participant votes — exactly one final option recorded", async () => {
  const poll = await createPoll({
    roomId: ROOM, authorId: p1, question: "R", options: ["X","Y","Z"],
    closesAt: new Date(Date.now() + 60_000),
  });
  const [oX, oY, oZ] = poll.options;
  await Promise.all([
    castVote({ pollId: poll.id, participantId: p2, optionId: oX.id }),
    castVote({ pollId: poll.id, participantId: p2, optionId: oY.id }),
    castVote({ pollId: poll.id, participantId: p2, optionId: oZ.id }),
  ]);
  const [view] = (await getOpenPollsForRoom(ROOM, p2)).filter(v => v.id === poll.id);
  assert.equal(view.totalVotes, 1, "PK enforces one vote row");
  assert.ok([oX.id, oY.id, oZ.id].includes(view.myVoteOptionId));
});
```

**Step 2: Run**

```bash
createdb mindforum_poll_test 2>/dev/null || true
PGDATABASE=mindforum_poll_test psql -f db/schema.sql > /dev/null
PGDATABASE=mindforum_poll_test node --test lib/poll-store.test.mjs
dropdb mindforum_poll_test
```

**Step 3: Commit**

```bash
git add lib/poll-store.test.mjs
git commit -m "test(store): hidden-tally enforcement + concurrent-vote race"
```

---

## Task 15: Extend `Brief` type + `generateBrief` for `decisions[]`

**Files:**
- Modify: `lib/openai.ts`

**Step 1: Update the type and schema**

Replace the `Brief` type (around line 74) with:

```ts
export type BriefDecision = {
  question: string;
  closedAt: string;            // ISO 8601
  winnerText: string | null;
  tallies: { option: string; votes: number }[];
  totalVotes: number;
  inconclusive: boolean;
};

export type Brief = {
  themes: string[];
  outline: { section: string; points: string[] }[];
  risks: string[];
  nextSteps: string[];
  suggestedCollaborators: string[];
  decisions: BriefDecision[];
};
```

Update `generateBrief`'s signature and schema:

```ts
export async function generateBrief(
  messages: Message[],
  files: RoomFile[],
  systemPrompt = "",
  closedPolls: BriefDecision[] = [],   // NEW
): Promise<Brief> {
  const pollBlock = closedPolls.length === 0
    ? ""
    : `\n\nClosed polls (echo verbatim into decisions[], do not edit text or counts):\n${JSON.stringify(closedPolls)}`;

  const system = `You turn a MindForum conversation, shared files, and any closed polls into a structured project brief. Be specific, not generic. Every item should be grounded in the conversation, the files, or the polls. If a section has no grounding, return an empty array for it rather than inventing content.${roomGuidanceBlock(systemPrompt)}${fileBlock(files)}${pollBlock}`;

  const res = await client().chat.completions.create({
    model: MODEL_BRIEF,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ProjectBrief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            themes: { type: "array", items: { type: "string" } },
            outline: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  section: { type: "string" },
                  points: { type: "array", items: { type: "string" } },
                },
                required: ["section", "points"],
              },
            },
            risks: { type: "array", items: { type: "string" } },
            nextSteps: { type: "array", items: { type: "string" } },
            suggestedCollaborators: { type: "array", items: { type: "string" } },
            decisions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  question: { type: "string" },
                  closedAt: { type: "string" },
                  winnerText: { type: ["string", "null"] },
                  tallies: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        option: { type: "string" },
                        votes: { type: "integer" },
                      },
                      required: ["option", "votes"],
                    },
                  },
                  totalVotes: { type: "integer" },
                  inconclusive: { type: "boolean" },
                },
                required: ["question", "closedAt", "winnerText", "tallies", "totalVotes", "inconclusive"],
              },
            },
          },
          required: ["themes", "outline", "risks", "nextSteps", "suggestedCollaborators", "decisions"],
        },
      },
    },
    messages: [{ role: "system", content: system }, ...historyBlock(messages)],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Brief;
  // Post-validate: overwrite any echo drift with DB-canonical data.
  parsed.decisions = closedPolls;
  return parsed;
}
```

**Step 2: Commit**

```bash
git add lib/openai.ts
git commit -m "feat(brief): extend with decisions[] — LLM echo + DB post-validate"
```

---

## Task 16: Plumb closed polls into the brief route

**Files:**
- Modify: `app/api/room/[id]/brief/route.ts`

**Step 1: Build the `closedPolls` payload before calling `generateBrief`**

```ts
import { getClosedPollsForRoom } from "@/lib/store";
import type { BriefDecision } from "@/lib/openai";

// ... existing handler body ...

const closed = await getClosedPollsForRoom(id, 100);
const briefDecisions: BriefDecision[] = closed.map(p => ({
  question: p.question,
  closedAt: new Date(p.closedAt ?? Date.now()).toISOString(),
  winnerText: p.winnerOptionId
    ? p.tallies.find(t => t.optionId === p.winnerOptionId)?.text ?? null
    : null,
  tallies: p.tallies.map(t => ({ option: t.text, votes: t.votes })),
  totalVotes: p.totalVotes,
  inconclusive: p.inconclusive,
}));

const brief = await generateBrief(messages, selectedFiles, systemPrompt, briefDecisions);
```

**Step 2: Commit**

```bash
git add app/api/room/[id]/brief/route.ts
git commit -m "feat(brief): plumb closed polls into generateBrief"
```

---

## Task 17: Brief renderer — "Decisions & Votes" section

**Files:**
- Modify: wherever the `Brief` React component lives (find via `grep -rln "themes.*outline\|risks.*nextSteps" app components 2>/dev/null`)
- Modify: the markdown serializer (find via `grep -rln "## Themes\|## Outline\|## Risks" app components lib`)

**Step 1: Add JSX between Risks and Next Steps**

```tsx
{brief.decisions.length > 0 && (
  <section className="brief-section">
    <h3>Decisions & Votes</h3>
    <ul>
      {brief.decisions.map((d, i) => (
        <li key={i}>
          <div className="decision-q">{d.question}</div>
          <div className="decision-meta">
            Closed {new Date(d.closedAt).toLocaleDateString()} · {d.totalVotes} votes
            {d.inconclusive && <span className="muted"> (inconclusive)</span>}
          </div>
          <ul className="decision-tallies">
            {d.tallies.map((t, j) => (
              <li key={j} className={t.option === d.winnerText ? "winner" : ""}>
                {t.option === d.winnerText ? <strong>{t.option}</strong> : t.option}
                {" — "}{t.votes} {t.votes === 1 ? "vote" : "votes"}
                {t.option === d.winnerText && " (winner)"}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  </section>
)}
```

**Step 2: Add markdown emission**

In the serializer, after Risks block, before Next steps:

```ts
if (brief.decisions.length > 0) {
  md += "\n## Decisions & Votes\n";
  for (const d of brief.decisions) {
    md += `\n### ${d.question}\n`;
    md += `*Closed ${new Date(d.closedAt).toLocaleDateString()} · ${d.totalVotes} votes${d.inconclusive ? " (inconclusive)" : ""}*\n\n`;
    for (const t of d.tallies) {
      const isWinner = t.option === d.winnerText;
      md += `- ${isWinner ? `**${t.option}**` : t.option} — ${t.votes} ${t.votes === 1 ? "vote" : "votes"}${isWinner ? " (winner)" : ""}\n`;
    }
  }
}
```

**Step 3: Commit**

```bash
git add <touched-files>
git commit -m "feat(brief): render Decisions & Votes section (JSX + markdown)"
```

---

## Task 18: UI — `<PollLaunchModal>`

**Files:**
- Create: `components/PollLaunchModal.tsx` (match existing component dir convention — `grep -rln "use client" components` first)

**Step 1: Implement**

Component skeleton — full implementation included since UI is the biggest delivery risk:

```tsx
"use client";
import { useEffect, useState } from "react";

type Draft = { question: string; options: string[] };
type Duration = "5m" | "15m" | "1h" | "24h" | "manual";

export function PollLaunchModal({
  roomId, onClose, onLaunched,
}: {
  roomId: string;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [duration, setDuration] = useState<Duration>("1h");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function fetchDraft() {
    setLoading(true);
    try {
      const r = await fetch(`/api/room/${roomId}/poll/draft`, { method: "POST" });
      const d = (await r.json()) as Draft;
      setQuestion(d.question);
      setOptions(d.options.length >= 2 ? d.options : ["", ""]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDraft(); }, []);

  const trimmed = options.map(o => o.trim()).filter(Boolean);
  const unique = new Set(trimmed.map(s => s.toLowerCase())).size === trimmed.length;
  const canLaunch = question.trim().length > 0 && trimmed.length >= 2 && unique && !submitting;

  async function launch() {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/room/${roomId}/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, options, duration }),
      });
      if (!r.ok) {
        const e = await r.json();
        setError(e.error ?? "unknown");
        return;
      }
      onLaunched();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--poll" onClick={e => e.stopPropagation()}>
        <header>
          <h2>Propose a vote</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </header>
        {loading ? (
          <div className="poll-draft-loading">✨ Drafting from recent conversation…</div>
        ) : (
          <>
            <label>Question</label>
            <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} />

            <label>Options</label>
            {options.map((o, i) => (
              <div key={i} className="poll-option-row">
                <input
                  value={o}
                  onChange={e => setOptions(opts => opts.map((x, j) => j === i ? e.target.value : x))}
                  placeholder={`Option ${i + 1}`}
                />
                {options.length > 2 && (
                  <button onClick={() => setOptions(opts => opts.filter((_, j) => j !== i))} aria-label="Remove option">✕</button>
                )}
              </div>
            ))}
            {options.length < 5 && (
              <button onClick={() => setOptions(opts => [...opts, ""])}>+ Add option</button>
            )}

            <label>Closes in</label>
            <div className="poll-duration">
              {(["5m", "15m", "1h", "24h", "manual"] as Duration[]).map(d => (
                <label key={d}>
                  <input type="radio" checked={duration === d} onChange={() => setDuration(d)} />
                  {d === "manual" ? "Manual close only" : d}
                </label>
              ))}
            </div>

            {error && <div className="poll-error">{error}</div>}

            <footer>
              <button onClick={fetchDraft} disabled={submitting}>↻ Re-draft from chat</button>
              <button onClick={onClose}>Cancel</button>
              <button onClick={launch} disabled={!canLaunch}>
                {submitting ? "Launching…" : "Launch"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add CSS (mobile sheet variant)** in the existing global stylesheet — `grep -rln "modal-backdrop" app components` for the file. Add:

```css
@media (max-width: 640px) {
  .modal--poll {
    position: fixed; inset: auto 0 0 0; height: 100dvh;
    max-height: 100dvh; border-radius: 12px 12px 0 0;
    animation: sheet-up 0.2s ease-out;
  }
  @keyframes sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }
}
```

**Step 3: Commit**

```bash
git add components/PollLaunchModal.tsx <stylesheet>
git commit -m "feat(ui): PollLaunchModal — AI draft + edit + duration + mobile sheet"
```

---

## Task 19: UI — `<PollCardOpen>` and `<PollCardClosed>`

**Files:**
- Create: `components/PollCard.tsx`

**Step 1: Implement**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { OpenPollView, ClosedPollView } from "@/lib/store";

export function PollCard({ poll, currentParticipantId, isAdmin }: {
  poll: OpenPollView | ClosedPollView;
  currentParticipantId: string;
  isAdmin: boolean;
}) {
  return poll.status === "open"
    ? <PollCardOpen poll={poll} currentParticipantId={currentParticipantId} isAdmin={isAdmin} />
    : <PollCardClosed poll={poll} currentParticipantId={currentParticipantId} />;
}

function PollCardOpen({ poll, currentParticipantId, isAdmin }: {
  poll: OpenPollView;
  currentParticipantId: string;
  isAdmin: boolean;
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(poll.closesAt));
  const [voting, setVoting] = useState(false);
  const canClose = poll.authorId === currentParticipantId || isAdmin;

  useEffect(() => {
    if (poll.closesAt == null) return;
    const t = setInterval(() => setRemaining(secondsUntil(poll.closesAt)), 1000);
    return () => clearInterval(t);
  }, [poll.closesAt]);

  async function vote(optionId: string) {
    setVoting(true);
    try {
      await fetch(`/api/room/${poll.roomId}/poll/${poll.id}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      // SSE will fold the new totalVotes back into state.
    } finally {
      setVoting(false);
    }
  }

  async function closeNow() {
    await fetch(`/api/room/${poll.roomId}/poll/${poll.id}/close`, { method: "POST" });
  }

  return (
    <div className="poll-card poll-card--open">
      <header>
        🗳️ Poll from <strong>{poll.authorName}</strong> ·{" "}
        {poll.closesAt == null
          ? "manual close"
          : remaining > 0 ? `ends in ${fmt(remaining)}` : "closing…"}
      </header>
      <div className="poll-question">{poll.question}</div>
      <ul className="poll-options">
        {poll.options.map(o => (
          <li key={o.id}>
            <label>
              <input
                type="radio"
                checked={poll.myVoteOptionId === o.id}
                onChange={() => vote(o.id)}
                disabled={voting}
              />
              {o.text}
              {poll.myVoteOptionId === o.id && <span className="muted"> ← your vote</span>}
            </label>
          </li>
        ))}
      </ul>
      <footer className="poll-footer">
        <span className="muted">{poll.totalVotes} votes · results hidden until close</span>
        {canClose && <button onClick={closeNow}>Close now</button>}
      </footer>
    </div>
  );
}

function PollCardClosed({ poll, currentParticipantId }: {
  poll: ClosedPollView;
  currentParticipantId: string;
}) {
  const maxVotes = Math.max(1, ...poll.tallies.map(t => t.votes));
  const myVote = poll.tallies.find(t => /* matched via separate API or local state */ false);

  return (
    <div className="poll-card poll-card--closed">
      <header>
        🗳️ Poll from <strong>{poll.authorName}</strong> ·{" "}
        {poll.closedBy === "auto" ? "auto-closed" : `closed early by ${poll.authorName}`} ·{" "}
        {poll.totalVotes} votes
      </header>
      <div className="poll-question">{poll.question}</div>
      <ul className="poll-tallies">
        {poll.tallies.map(t => (
          <li key={t.optionId}>
            <span className="poll-tally-text">{t.text}</span>
            <span className="poll-tally-bar" style={{ width: `${(t.votes / maxVotes) * 100}%` }} />
            <span className="poll-tally-count">{t.votes}</span>
          </li>
        ))}
      </ul>
      <footer>
        {poll.winnerOptionId
          ? <>Winner: <strong>"{poll.tallies.find(t => t.optionId === poll.winnerOptionId)?.text}"</strong></>
          : poll.totalVotes === 0
            ? "No votes cast."
            : "Tie."}
      </footer>
    </div>
  );
}

function secondsUntil(ts: number | null): number {
  if (ts == null) return 0;
  return Math.max(0, Math.floor((ts - Date.now()) / 1000));
}
function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
```

**Step 2: Commit**

```bash
git add components/PollCard.tsx
git commit -m "feat(ui): PollCard — open (hidden tallies) and closed (bars + winner) states"
```

---

## Task 20: Intercept `/poll` in chat input + render poll cards in stream

**Files:**
- Modify: the chat input component (find via `grep -rln "TextareaAutosize" components app`)
- Modify: the message list renderer (find via `grep -rln "messages.map\|kind === .brief" components app`)

**Step 1: In the chat input submit handler**

Before the regular send call:

```ts
const text = inputValue.trim();
if (text.startsWith("/poll") && (text === "/poll" || text.startsWith("/poll "))) {
  setInputValue("");
  setShowPollModal(true);
  return;
}
// ...existing send logic
```

Add state + render:

```tsx
const [showPollModal, setShowPollModal] = useState(false);
// ...
{showPollModal && (
  <PollLaunchModal
    roomId={roomId}
    onClose={() => setShowPollModal(false)}
    onLaunched={() => setShowPollModal(false)}
  />
)}
```

**Step 2: In the message list renderer**

The room state now includes `openPolls` and `recentClosedPolls`. Interleave them into the chat stream by sorting all entries by `createdAt` (polls use `createdAt`, messages use `createdAt`). Render polls via `<PollCard>` rather than the message renderer.

```tsx
const stream = useMemo(() => {
  const items = [
    ...messages.map(m => ({ kind: "msg" as const, at: m.createdAt, data: m })),
    ...openPolls.map(p => ({ kind: "poll" as const, at: p.createdAt, data: p })),
    ...recentClosedPolls.map(p => ({ kind: "poll" as const, at: p.createdAt, data: p })),
  ];
  return items.sort((a, b) => a.at - b.at);
}, [messages, openPolls, recentClosedPolls]);

// ...
{stream.map(item => item.kind === "msg"
  ? <MessageBubble key={item.data.id} message={item.data} />
  : <PollCard key={item.data.id} poll={item.data} currentParticipantId={pid} isAdmin={admin} />)}
```

**Step 3: Wire SSE event handlers**

In the existing SSE consumer:

```ts
es.addEventListener("poll_opened", (e) => {
  const data = JSON.parse(e.data);
  setOpenPolls(prev => [...prev, /* construct OpenPollView from data */]);
});
es.addEventListener("poll_vote", (e) => {
  const { pollId, totalVotes } = JSON.parse(e.data);
  setOpenPolls(prev => prev.map(p => p.id === pollId ? { ...p, totalVotes } : p));
});
es.addEventListener("poll_closed", (e) => {
  const data = JSON.parse(e.data) as ClosedPollView;
  setOpenPolls(prev => prev.filter(p => p.id !== data.id));
  setRecentClosedPolls(prev => [...prev, data]);
});
```

**Step 4: Commit**

```bash
git add <touched-files>
git commit -m "feat(ui): intercept /poll, render PollCard in stream, wire SSE handlers"
```

---

## Task 21: Manual smoke checklist

**Files:**
- Modify: nothing — this is a checklist run locally before merging.

**Step 1: Local dev**

```bash
npm install
npm run migrate    # applies v6 to local dev DB
npm run dev
```

Open <http://localhost:3000> in **two browsers** (or one + incognito) joined to the same test room as different participants.

**Step 2: Walk the golden path**

- [ ] In one window, type `/poll` and submit. Modal opens. AI draft populates within ~2s. Edit a field. Launch.
- [ ] Poll card appears in BOTH windows via SSE.
- [ ] Each window casts a vote. Each window sees `totalVotes` increment. Neither sees per-option breakdown.
- [ ] In voter window, click a different option. `totalVotes` does **not** change.
- [ ] Wait for the timer to expire (or click `Close now` as the author). Both windows flip to closed view with full tallies + winner line.
- [ ] Click `Generate brief`. Brief includes a "Decisions & Votes" section. Tallies match.
- [ ] Click `↓ Download .md`. Markdown contains the Decisions section.

**Step 3: Edge cases**

- [ ] `/poll` in an empty room (no recent messages). AI returns `options: []`. Modal opens with blank fields + hint.
- [ ] Launch a poll with `[A, a]` (case-only duplicates). 400 error in inline modal display.
- [ ] Launch a poll with 1 non-empty option. Launch button disabled.
- [ ] Vote on an already-expired poll (force via DB UPDATE). 409 response, card flips to closed.
- [ ] Mobile Safari (or DevTools mobile mode <640px). Launch modal becomes full-screen sheet. Poll card readable.
- [ ] Close laptop lid 2 min during open poll, reopen. SSE reconnects. Vote state still correct.

**Step 4: Commit nothing — these are runtime checks**

If any check fails, fix the failing task and re-run only the affected check.

---

## Task 22: Update CLAUDE.md (roadmap + session log)

**Files:**
- Modify: `mindforum/CLAUDE.md`

**Step 1: Mark roadmap item complete**

Find the `## Roadmap` section. Add a new line:

```markdown
- [x] **Polls & Decisions** — /poll command with AI option draft, hidden-tally voting, lazy expiry, brief integration — shipped 2026-MM-DD, [PR #XX](https://github.com/gies-ai-experiments/MindForum/pull/XX)
```

**Step 2: Add session log entry**

Under `## Session Log`:

```markdown
### 2026-MM-DD
- Completed: Polls & decisions feature. Migration v6 (polls/poll_options/poll_votes), four new POST routes under `/api/room/[id]/poll/...`, three SSE events (poll_opened/poll_vote/poll_closed), lazy close on every poll route + GET room + POST message. AI used in two spots: draftPollFromHistory (json_schema strict) at launch, and decisions[] echo in generateBrief with DB post-validation. All closed polls auto-flow into the brief's new "Decisions & Votes" section.
- Next: [whatever's next on the roadmap]
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: session log + roadmap — polls & decisions shipped"
```

---

## Task 23: Push via `/gitpush`

**Step 1:** Invoke the `/gitpush` skill. **Do not** run `git push` directly. The skill runs a secret scan and pushes to `gies-ai-experiments/MindForum`. Auto-deploy (GitHub Actions → VPS) fires and runs `scripts/deploy.sh`.

**Step 2: Verify auto-deploy**

```bash
ssh vps "pm2 logs mindforum --lines 30 --nostream"
ssh vps "curl -sf http://localhost:3006/api/health || curl -sI http://localhost:3006/"
```

**Step 3: Live smoke**

Visit the production URL, create a real test room (or use an existing one), run `/poll` end-to-end. Generate brief. Verify "Decisions & Votes" appears.

---

## Open questions / merge-time work

1. **Migration version collision** with `creator-rooms-v1` branch (which reserved v6/v7/v8). If that branch ever merges first, renumber this migration to v9 and `INSERT ... (9)` accordingly.
2. **Co-facilitator role**: once creator-rooms-v1 ships, decide whether `/poll` authorship should narrow to creator + co-facilitators. The current "any participant" model is forward-compatible — just swap `requireRoomParticipant` for a creator-or-facilitator check in the four poll routes.
3. **Vote-change history**: only if a stakeholder asks. Schema-compatible via a new `poll_vote_history` table; the current `(poll_id, participant_id)` PK preserves UPSERT semantics.
4. **Multi-select polls**: track usage signal; if "single-choice was too constraining" comes up >2x, add a `mode` column to `polls`.
