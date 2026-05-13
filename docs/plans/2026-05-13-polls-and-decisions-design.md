# Polls & Decisions — Design

**Date:** 2026-05-13
**Status:** Approved (brainstorming phase)
**Branch target:** off `main` (does not depend on `creator-rooms-v1`)
**Next step:** implementation plan via `writing-plans`

---

## Problem

MindForum rooms generate lots of ideas but have no built-in way to converge. Facilitators currently have to copy-paste options into the chat and ask people to react with emoji, which doesn't scale, doesn't persist, and doesn't end up in the project brief.

Observed in real rooms.

## Goal

Turn MindForum from a brainstorming tool into a decision-making tool by adding:

1. A `/poll` command any participant can call.
2. AI-drafted options extracted from recent conversation, edited by the caller before launch.
3. Single-choice voting with hidden tallies until close.
4. Caller-chosen duration (5min / 15min / 1hr / 24hr / manual), with lazy expiry.
5. Automatic inclusion of every closed poll in the project brief's new `Decisions & Votes` section.

## Non-goals (v1)

- No co-facilitator / role system. Any participant can launch. (creator-rooms-v1 may layer on later.)
- No vote-change history. The current vote is the only state stored.
- No archive page. Closed polls live in chat history; the brief is the digest.
- No notifications. Existing `@mention` covers async awareness.
- No reactions on poll cards.
- No load-tested concurrency model. Current rooms ≤20 participants.

---

## Decisions log (from brainstorming)

| # | Question | Decision |
|---|---|---|
| 1 | Origin signal | Observed in real rooms (not speculative) |
| 2 | Authorship | Any participant (on `main`, since no creator concept exists) |
| 3 | AI extraction | AI drafts → human edits → launch (never one-click) |
| 4 | Vote mechanics | Single-choice, hidden until close, changeable until close |
| 5 | Poll closing | Caller picks duration at launch; manual close-now also allowed |
| 6 | Brief inclusion | All closed polls, automatically |
| 7 | Branch base | Fresh branch off `main`; ignore `creator-rooms-v1` for now |

---

## Architecture overview

**Three new tables** (schema migration v6): `polls`, `poll_options`, `poll_votes`.

**Four new API routes** under `/api/room/[id]/`: `poll/draft`, `poll`, `poll/[pollId]/vote`, `poll/[pollId]/close`.
Reads piggyback on existing `GET /api/room/[id]`.

**Three new SSE events**: `poll_opened`, `poll_vote` (count only), `poll_closed` (full tallies).

**Lazy expiry**: no scheduler. A `closeExpiredPolls(roomId)` helper runs at the top of every poll route handler and at the top of `GET /api/room/[id]` and `POST /api/room/[id]/message`. Idempotent SQL guard prevents double-close.

**Two LLM call sites**:
1. `/poll/draft` — extracts `{question, options[]}` from last ~20 messages (json_schema strict mode).
2. `generateBrief` (existing) — extended with `decisions[]` field; LLM echoes DB-canonical poll data; post-validation overwrites any mismatch.

**AI is a drafter, not a decider.** Every vote count, close trigger, and tally is deterministic SQL.

---

## Data model (schema v6)

```sql
CREATE TABLE polls (
  id              TEXT PRIMARY KEY,                -- 'pl_<short-id>'
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id       TEXT NOT NULL,                   -- participants.id of caller
  question        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open','closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at       TIMESTAMPTZ,                     -- NULL = manual close only
  closed_at       TIMESTAMPTZ,                     -- NULL while open
  closed_by       TEXT                             -- participant id | 'auto'
);

CREATE TABLE poll_options (
  id        TEXT PRIMARY KEY,                      -- 'po_<short-id>'
  poll_id   TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  position  INT  NOT NULL,                         -- 0..4, render order
  text      TEXT NOT NULL,
  UNIQUE (poll_id, position)
);

CREATE TABLE poll_votes (
  poll_id        TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  option_id      TEXT NOT NULL REFERENCES poll_options(id),
  cast_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, participant_id)            -- UPSERT on conflict = change vote
);

CREATE INDEX polls_room_status_idx ON polls(room_id, status);
```

**Key invariants:**
- Canonical "open" predicate: `status='open' AND (closes_at IS NULL OR closes_at > NOW())`.
- One row per `(poll_id, participant_id)` — change vote = UPDATE in place. No history.
- `closed_by` is a string, not an FK — survives participant deletion and represents `'auto'` cleanly.
- No new `audit_log` table on this branch (creator-rooms-v1 owns that).

---

## API surface

| Method | Path | Purpose | Rate limit (per IP) |
|---|---|---|---|
| `POST` | `/api/room/[id]/poll/draft` | LLM extracts `{question, options[]}` from last ~20 messages; not persisted | 5 / 5min |
| `POST` | `/api/room/[id]/poll` | Launch poll; inserts `polls` + `poll_options`; broadcasts `poll_opened` | 5 / 10min |
| `POST` | `/api/room/[id]/poll/[pollId]/vote` | UPSERT `poll_votes`; broadcasts `poll_vote` with `totalVotes` only | 30 / 1min |
| `POST` | `/api/room/[id]/poll/[pollId]/close` | Set `status='closed'`; broadcasts `poll_closed` with full tallies | 10 / 1min |

**Reads** piggyback on `GET /api/room/[id]`, which gains:
- `openPolls[]` — open polls with the requester's own vote + `totalVotes`, no breakdown
- `recentClosedPolls[]` — last ~10 closed, full tallies

**Authorization** (server-side, every poll route):
- Valid `mindforum_pid_<roomid>` cookie mapping to a `participants` row for that room.
- `close` route additionally requires `participant_id == polls.author_id` OR a valid `ADMIN_TOKEN` cookie.
- `vote` route requires open status — lazy-close runs first.

**SSE events:**
- `poll_opened` — `{ pollId, question, options, closesAt, authorId, authorName }`
- `poll_vote` — `{ pollId, totalVotes }` *(no per-option breakdown)*
- `poll_closed` — `{ pollId, tallies: [{optionId, text, votes}], winnerOptionId, totalVotes }`

**Lazy-close helper:**

```ts
async function closeExpiredPolls(roomId: string): Promise<string[]> {
  // Returns IDs of polls that just transitioned from open → closed.
  // Caller is responsible for broadcasting poll_closed for each.
  return await sql`
    UPDATE polls
    SET status='closed', closed_at=NOW(), closed_by='auto'
    WHERE room_id = ${roomId}
      AND status='open'
      AND closes_at IS NOT NULL
      AND closes_at <= NOW()
    RETURNING id
  `;
}
```

Idempotent — the `WHERE status='open'` guard prevents double-close. Invoked at the top of every poll route, plus `GET /api/room/[id]` and `POST /api/room/[id]/message`.

---

## AI usage

### 1. `/poll/draft` — drafter

Reuses `MODEL_BRIEF` (structured output, not chat) with `json_schema` strict mode:

```ts
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
            minItems: 2,
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
```

**System prompt instructs:** extract an implicit decision-point from the conversation; produce 2–5 distinct, mutually exclusive options grounded only in what was said; if no convergeable question exists, return `options: []` (modal falls back to blank).

Draft is **ephemeral** — never persisted. Only the human-approved version reaches `polls` + `poll_options`.

### 2. `generateBrief` — formatter

`Brief` type extended:

```ts
export type Brief = {
  themes: string[];
  outline: { section: string; points: string[] }[];
  risks: string[];
  nextSteps: string[];
  suggestedCollaborators: string[];
  decisions: {
    question: string;
    closedAt: string;              // ISO 8601
    winnerText: string | null;     // null when tied or no votes
    tallies: { option: string; votes: number }[];
    totalVotes: number;
    inconclusive: boolean;         // totalVotes < 2 OR top-two tie
  }[];
};
```

Pre-LLM step in the brief route fetches all closed polls and passes them as a third arg. The LLM is told to **echo data verbatim**, never edit text or counts. Post-LLM, the server re-validates `brief.decisions` against the DB and overwrites any mismatch — eliminating hallucinated-tally as a failure class.

### AI is deliberately not used for

- Vote casting & tallying — pure DB.
- Auto-close on timer expiry — pure SQL.
- Hidden-tally enforcement — server-side response shaping.
- Filtering which polls "count" as decisions — all closed polls flow through.
- Validating option mutual exclusivity at launch — the caller already saw + edited them.

---

## UI

### Launch modal (`/poll`)

- Triggered by detecting `/poll` at the start of a message in the existing `<TextareaAutosize>` input.
- Opens with a spinner while `POST /poll/draft` runs (~1.5s).
- Form fields: question, 2–5 options (with `[+ Add option]` / per-row `[✕]`), duration radio (5min / 15min / 1hr / 24hr / Manual).
- `[↻ Re-draft from chat]` re-runs the draft (rate-limited).
- `Launch` disabled until: question non-empty, ≥2 non-empty options, all options unique (case-insensitive trim).
- `Launch` → `POST /poll`, modal closes, poll card appears via SSE `poll_opened` (no optimistic state).
- Below 640px: full-screen sheet sliding from bottom (matches 2026-05-07 narrow-viewport pattern).

### Poll card — open state

- Rendered inline in chat stream as a special message kind. Same column placement as a regular message, distinguishable border.
- Header: `🗳️ Poll from <author> · ends in MM:SS` (or `· manual close` if `closes_at IS NULL`).
- Radio options; selecting fires `POST /vote`. UI updates immediately on success.
- Footer: `N votes · results hidden until close`.
- Buttons: `[Change vote]` (always), `[Close now]` (only if caller or admin).
- Countdown is a client-side `setInterval` reading `closesAt`. On expiry, card shows `Closing…` and waits for `poll_closed` SSE (or any subsequent request triggers lazy-close).

### Poll card — closed state

- Header: `🗳️ Poll from <author> · closed (<duration> | early by <name> | auto) · N votes`.
- Each option rendered with a horizontal bar and vote count.
- Voter's own choice highlighted with `← your vote`.
- Winner line: `Winner: "<text>"` — or `Tie between N options.` — or `No votes cast.`

---

## Brief integration

- `POST /api/room/[id]/brief/route.ts` fetches closed polls before calling `generateBrief`.
- `generateBrief()` signature gains a fourth arg: `closedPolls: ClosedPoll[]`.
- System prompt addendum: *"Echo each closed poll into the `decisions` field verbatim. Set `inconclusive: true` when `totalVotes < 2` or the top two options are tied. The rest of the brief may reference decisions."*
- Post-validation re-checks `brief.decisions` against DB, overwrites mismatches.
- Brief renderer adds a "Decisions & Votes" section between Risks and Next steps, only if `decisions.length > 0`.
- Markdown download serializer extended to emit:

```markdown
## Decisions & Votes

### Which approach should we pursue?
*Closed 2026-05-12 · 5 votes*

- **Run a faculty-only pilot in Fall 2026** — 3 votes (winner)
- Open the tool to all instructors now — 2 votes
- Build a TA-facing variant first — 0 votes
```

---

## Error handling

| Failure | Server response | UI response |
|---|---|---|
| `/poll/draft` LLM timeout or 5xx | 200 with `{ question: "", options: [] }` | Modal opens with blank form + *"AI draft unavailable — fill in manually."* |
| `POST /poll` duplicate options (ci-trim) | 400 `{ error: "duplicate_options" }` | Inline error, highlight offending field |
| `POST /poll` <2 non-empty options | 400 `{ error: "min_options" }` | Launch button disabled — caught client-side first |
| `POST /vote` on closed poll | 409 `{ error: "poll_closed", tallies }` | Card flips to closed state with returned tallies |
| `POST /vote` on non-existent poll | 404 | Card removes itself from chat stream |
| `POST /close` by non-author non-admin | 403 | Button shouldn't have rendered — log + re-fetch state |
| Lazy-close fires on non-poll route | Closes + broadcasts, continues with original handler | Open cards across subscribers flip to closed |
| `generateBrief` echoes mismatched tallies | Post-validation overwrites with DB truth | Brief always shows DB truth |
| Process crash mid-vote | Atomic single-row UPSERT — no torn state | Next read shows committed side |
| Process crash between close + broadcast | Lazy-close idempotent on next read; in-flight subscribers miss event | Affected clients see closed state on next page action |

---

## Rate limits (additions to `lib/ratelimit.ts`)

| Key | Limit | Window | Notes |
|---|---|---|---|
| `poll-draft` | 5 | 5 min | Loose-ish; draft is cheap |
| `poll-create` | 5 | 10 min | Mirrors `POST /api/room` |
| `poll-vote` | 30 | 1 min | Tighter than message (60/min) |
| `poll-close` | 10 | 1 min | Same family as message edits |

All reset on process restart, per existing CLAUDE.md convention.

---

## Testing strategy

Mirror existing posture (`lib/admin-sort.test.mjs` — node test runner, no framework lock-in).

**Unit (`lib/poll-logic.test.mjs`):**
- Winner: clear winner / 2-way tie / 3-way tie / zero votes / single voter
- `inconclusive` flag: `totalVotes < 2` / top-two tie / decisive
- Option validation: duplicates / min 2 / max 5 / empty trim
- Lazy-close predicate: open + past `closes_at` → close; open + future → no-op; manual (`closes_at IS NULL`) → no-op; already-closed → no-op (idempotent)

**Integration (throwaway test DB, per 2026-05-08 pattern):**
- Full lifecycle: create → 3 votes → 1 change → close → tallies correct
- Concurrent same-participant vote race: exactly one final option recorded (PK enforces)
- Lazy-close idempotency: invoke twice, second call returns empty, no second broadcast
- Hidden-tally enforcement: `GET /api/room/[id]` while open returns `totalVotes` only; after close returns full breakdown
- Brief post-validation: mocked LLM response with corrupted tallies → output matches DB

**Manual smoke (before merge):**
- iPhone Safari: full-screen sheet on launch modal
- SSE reconnect mid-poll: close lid 2 min, reopen — card state correct, no double-vote
- Lazy-close on `/message` POST: leave tab open past `closes_at`, post message, verify `poll_closed` arrives

**Explicitly skipped:**
- Load testing (rooms ≤20 participants, well within SSE in-memory headroom)
- Multi-region (single-VPS deployment)

---

## Migration & rollout

1. Schema v6 migration (`db/schema.sql`) — three tables + index. Rerun-safe.
2. Library code: `lib/store.ts` (CRUD + lazy-close), `lib/openai.ts` (drafter + brief extension), `lib/ratelimit.ts` (4 new keys), `lib/sse.ts` consumers (new event types — lib itself unchanged).
3. Routes: 4 new files under `app/api/room/[id]/poll/…`; modify `brief/route.ts`, `[id]/route.ts`, `[id]/message/route.ts` to call `closeExpiredPolls`.
4. UI: launch modal component, poll card component (open + closed states), wire to chat stream renderer, extend brief renderer.
5. Tests + manual smoke.
6. Merge to `main` → auto-deploy (GitHub Actions → VPS).

No backfill needed. Existing rooms gain the feature instantly on deploy.

---

## Open questions / follow-ups (post-v1)

- **Co-facilitator role**: when `creator-rooms-v1` lands, decide whether poll authorship is still "any participant" or gated to creator + facilitators. Schema-compatible either way (just changes the API auth check).
- **Poll archive view**: if facilitators ask for a sortable list of all decisions across rooms, add a `/admin/decisions` page reading from `polls` + `poll_options` + `poll_votes`.
- **Multi-select / approval voting**: track usage signal; if "single-choice was too constraining" comes up >2x, add a `mode` column to `polls` and extend UI.
- **Vote-change history**: only if a stakeholder asks for it. Schema migration would add a `poll_vote_history` table; current PK preserves UPSERT semantics.

---

## Acceptance checklist

- [ ] Migration v6 applied, three tables present, index built.
- [ ] `POST /poll/draft` returns valid `{question, options}` or empty `options[]` on degraded LLM.
- [ ] `POST /poll` validates ≥2 unique options, persists `polls` + `poll_options`, broadcasts `poll_opened`.
- [ ] `POST /vote` UPSERTs, broadcasts `poll_vote` with `totalVotes` only (no breakdown leak).
- [ ] `POST /close` permissioned (author or admin), broadcasts `poll_closed` with full tallies.
- [ ] `GET /api/room/[id]` returns `openPolls[]` (no breakdown) + `recentClosedPolls[]` (full tallies).
- [ ] Lazy-close fires on every poll route, `GET /api/room/[id]`, and `POST /message`. Idempotent.
- [ ] Launch modal: AI draft, edit, duration picker, validation, full-screen sheet on mobile.
- [ ] Open poll card: live `totalVotes`, hidden breakdown, countdown, `[Change vote]`, `[Close now]` for author/admin.
- [ ] Closed poll card: full tallies, winner line, voter's own choice highlighted, tie/no-votes cases.
- [ ] `Brief.decisions[]` populated, post-validated against DB, rendered between Risks and Next steps, included in Markdown download.
- [ ] Rate limits enforced; reset-on-restart documented.
- [ ] All unit tests green; integration tests green against throwaway DB.
- [ ] Manual smoke: mobile sheet, SSE reconnect, lazy-close on `/message`.
- [ ] Auto-deploy to VPS succeeds; live smoke in a real room confirms end-to-end.
