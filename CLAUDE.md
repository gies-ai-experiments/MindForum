# MindForum

Shared AI brainstorming room app for small faculty groups. Next.js 15 + SSE + Postgres.

## Key paths

| | |
|---|---|
| Prod URL | (private — see `~/.claude/projects/-Users-vishal-research-mindforum/memory/`) |
| VPS path | `/root/repos/mindforum` (ssh alias `vps`) |
| Process | PM2 id `mindforum`, port 3006 |
| Database | Postgres: role `mindforum`, db `mindforum`, localhost:5432 |
| Repo | `gies-ai-experiments/MindForum` (public, MIT; deploy key `mindforum_deploy` on VPS) |

## Required env vars

`OPENAI_API_KEY` · `POSTGRES_URL` · `ADMIN_TOKEN` (for `/api/admin/seed`) · optional `OPENAI_MODEL` (default `gpt-5.4`).

## Deploy recipe

Push locally, then on VPS:

```bash
cd /root/repos/mindforum
git checkout -- package-lock.json    # npm install dirties this; clean before pull
git pull
npm install
npm run migrate                       # if db/schema.sql changed
npm run build
pm2 restart mindforum --update-env    # --update-env re-reads .env.local
```

See `~/.claude/references/vps-deployment.md` for shared-VPS gotchas (deploy keys, port binding, nginx).

## Reseeding a room at a specific ID

After a restart wipes process memory (pre-Postgres behavior) or when preloading a canonical room setup, use the admin seed endpoint. Script template at `/tmp/seed-mindforum-room.py` from the initial setup — scp to VPS and run. Canonical room for the 01-sequence AI ethics exercise is `ai-ethics-exercise` (config in `rooms/2026-04-20-ai-ethics-exercise-design/`).

## Rate limits (per-IP, in-memory)

`POST /api/room` 5/10min · `join` 10/min · `message` 60/min · `upload` 10/10min · `brief` 3/5min. Reset on process restart — by design.

## Architecture gotchas

- **`next start` doesn't read PORT from `.env.local`** — must be in shell env at `pm2 start` time. Already baked in; don't touch unless rebuilding the PM2 entry.
- **Admin seed `replaceMode: "metadata"` (default) preserves chat history**; `"full"` wipes the whole room. Matters for `/api/admin/seed` callers.
- **AI reply streaming flushes to Postgres every ~1s** during generation, plus a final flush. A mid-stream process crash loses only the unflushed tail; reconnecting clients see the last flushed state, never permanently-empty bubbles.
- **Don't write synthetic rows into `participants`** for non-membership purposes (e.g. file attribution, system messages). The participants table is the source of truth for the Participants sidebar, mention suggestions, the SSE snapshot, and `upsertParticipant` matches by `lower(email)` — so a synthetic row with a real user's email gets *adopted* by that user when they join, binding their cookie to the synthetic id. Attribute via lookup of an existing real participant instead, and accept "Unknown" as the fallback. Caught by codex-review on 2026-05-06.
- **`POST /api/room` body field is `id`, not `slug`** — the spec uses "slug" throughout but the wire format takes `body.id` (validated against `/^[a-z0-9-]{3,40}$/`). Sending `{slug: "..."}` returns 400 `invalid_slug`. Caught during 2026-05-13 acceptance walk; the field name predates the spec rewrite and renaming would break the legacy admin path.
- **Next 15 server components can't mutate cookies** — `cookies().delete()` / `.set()` only work in route handlers, server actions, and middleware. RSCs (even `dynamic = "force-dynamic"`) throw if you try. To recycle a stale cookie from a server-component page (e.g. `/dashboard` detects "cookie present + getCreator() null"), `redirect()` to a GET route handler that does the delete + redirects back. See `app/dashboard/auth/route.ts` GET handler for the pattern.
- **Renaming a room id orphans cookies.** Browser sessions store `mindforum_pid_<roomid>`; if you rename the room PK (insert-new → repoint children → delete-old transaction), users who joined the old id can't auth into the new id and must re-join. No FK ON UPDATE CASCADE on schema. Only safe before invitations go out.

## Room configs

Per-room setup artifacts live under `rooms/YYYY-MM-DD-<slug>/`:
- `README.md` — room setup checklist
- `facilitator-system-prompt.md` — AI guidance to paste at room creation
- other supporting files (source transcripts, draft prompts, etc.) — uploaded to the room

## Current Focus

Creator-rooms v1 is live with the first real creator signed in (Ashleyn Castelino). Sentry is wired. Watch for first real-creator usage + Sentry alerts; gather feedback before opening v2 (per-creator OpenAI keys + spend caps + usage events). Side items still pending: OpenAI monthly spend cap on the global key (defense-in-depth #2), faculty invitation for `ai-ethics-exercise`, 2026-05-25 four-week MSBAi review.

## Auto-deploy

Push to `main` (or run workflow_dispatch) → GitHub Actions SSHes to the VPS and runs `scripts/deploy.sh` (pull → install → migrate → build → pm2 restart → localhost health check). Dedicated SSH key (`~/.ssh/mindforum_actions` locally) is locked to `command="bash /root/repos/mindforum/scripts/deploy.sh"` in VPS `~/.ssh/authorized_keys` — even if the GitHub `VPS_SSH_KEY` secret leaks, the key can only run the deploy. **If `scripts/deploy.sh` ever moves or gets renamed, update the `command=` prefix on the VPS at the same time** or the workflow silently fails with "No such file or directory". Bypass: regular `ssh vps` still works for ad-hoc shell access via `~/.ssh/id_ed25519`.

## Roadmap

- [x] MVP from Ash's spec
- [x] Deploy to VPS behind nginx + Cloudflare
- [x] Token-streamed `@ai` replies
- [x] Per-room system prompt + file upload
- [x] Project brief with `↓ Download .md`
- [x] Admin seed endpoint (URL-stable rooms)
- [x] Per-IP rate limiter
- [x] Postgres persistence (chat history survives restarts)
- [x] Repo flipped public + MIT LICENSE + topics; `rooms/` stripped from history
- [x] `POST /api/room` gated behind `ADMIN_TOKEN` (defense-in-depth for public repo)
- [x] Hybrid Builder article drafted, trimmed, RSA-Animate cover images generated (v1 picked)
- [x] Substack + LinkedIn drafts loaded; X thread composed in modal
- [x] Final publish on Substack + LinkedIn + X (live 2026-04-25)
- [x] GPM stakeholder brainstorm room (`gpm-brainstorm`) seeded with Marketplace Co-pilot prompt + proposal file uploaded
- [x] MSBAi stakeholder rooms seeded (`msbai-pilot-faculty` 22 files, `msbai-corporate-partners` 8 files); daily KB refresh via `rooms/refresh-msbai-kb.sh` cron at 06:00 UTC; system prompts auto-stamp `last refresh` date
- [x] Render `@ai` replies as markdown (react-markdown + remark-gfm); human messages keep existing renderer
- [x] Catch-up modal now blocks "Got it" until summary lands (prevents fast-clickers dismissing before bullets render)
- [x] Send MSBAi room invitations (faculty/staff list + corporate partners individually) — sent 2026-04-27
- [x] Admin rooms dashboard `/admin/rooms` (sortable activity table, name filter, copy-link, cookie auth via existing `ADMIN_TOKEN`) — shipped 2026-04-28, [PR #6](https://github.com/gies-ai-experiments/MindForum/pull/6)
- [x] `@`-mention notifications + live in-input mention coloring — [PR #8](https://github.com/gies-ai-experiments/MindForum/pull/8), shipped 2026-05-01
- [x] GitHub Actions auto-deploy on push to `main` (restricted SSH key, idempotent `scripts/deploy.sh`, ~32s end-to-end) — shipped 2026-05-01
- [x] File-content preview UX (modal with markdown render) — issue [#5](https://github.com/gies-ai-experiments/MindForum/issues/5), [PR #10](https://github.com/gies-ai-experiments/MindForum/pull/10), shipped 2026-05-06
- [x] Multi-line chat input (TextareaAutosize, Enter/Shift+Enter, IME-safe) — shipped 2026-05-06
- [x] File uploader attribution in Files panel + preview modal; seeded files attribute via email lookup to existing real participant — shipped 2026-05-06
- [x] Mobile/narrow-viewport pass: drawer-based Participants/Files, single-column chat, `100dvh` for iOS keyboard — shipped 2026-05-07
- [x] Faculty brainstorm room for Gies AI Teaching Showcase (`ai-in-teaching-research`) — seeded with co-facilitator system prompt + AI starter message, 2026-05-07
- [x] Co-authoring room for Innovation & Transformation group (`innovation-transformation`) — 2026-05-07
- [x] Creator-owned rooms design spec + v1-minimum trim — 3 rounds Codex Plan Reviewer, APPROVED, merged via [PR #11](https://github.com/gies-ai-experiments/MindForum/pull/11). v1 spec at `docs/plans/2026-05-07-creator-rooms-v1-min.md` is the implementation contract.
- [x] **Implement v1 creator-owned rooms** per `docs/plans/2026-05-07-creator-rooms-v1-min.md` — code complete on `creator-rooms-v1` (8 commits, ~3.5K lines): migrations v6/v7/v8, store extensions (owner/archive/allowlist CRUD), API surface (creator session, admin users, archive/transfer/hard-delete, dual-auth `/api/room`), `/dashboard` + sign-in + create form, `/dashboard/rooms/[id]/settings` (general/files/participants/activity), middleware gate, `/admin/users` CRUD with one-time token reveal, `/admin/rooms` Owner column + status filter, `/room/[id]` archived banner + composer hide, participant kick route. Merged via PR #12.
- [x] **Verify creator-rooms v1 against Acceptance Checklist on the deployed VPS** — [PR #12](https://github.com/gies-ai-experiments/MindForum/pull/12) merged 2026-05-13. Two codex-review rounds against `main` (P1 edge-runtime middleware import bleed → extracted `lib/creator-cookie.ts`; P2 archived-owner can't view room → join returns 200 + `readOnly` for owners; P2 stale creator cookie not cleared → `GET /dashboard/auth` recycles). Auto-deploy ran v6/v7/v8 on live DB. All 12 acceptance items walked end-to-end on prod via curl + psql; first creator (Ashleyn Castelino) provisioned.
- [x] **Polls & Decisions v1** — `/poll` command with AI option draft (grounded in recent chat + room system prompt), single-choice hidden-tally voting (5m/15m/1h/24h/manual), lazy expiry, automatic inclusion in project brief's new "Decisions & Votes" section. Live composer highlight (navy border + bold-navy `/poll` overlay) mirrors the existing `@ai` orange pattern. Rebased onto `creator-rooms-v1` main as `polls-and-decisions-v2`; migration renumbered v6 → v9. Admin-facilitator UI (close/mute/remove/rename + expandable rows) deliberately skipped from the merge — supporting infrastructure (v10 columns, store fns, routes) is in for a follow-up PR. Design `docs/plans/2026-05-13-polls-and-decisions-design.md`, plan `docs/plans/2026-05-13-polls-and-decisions.md`.
- [x] **Super-admin archive/delete UI on `/admin/rooms`** — per-row Actions column (Archive on active rooms; Restore + type-to-confirm Delete on archived). `hardDeleteRoom` enforces archived-only atomically (conditional `DELETE … WHERE archived_at IS NOT NULL`); `DELETE /api/room/[id]` returns `409 not_archived` / `404 not_found`. Spec + plan in `docs/superpowers/`, 2 Codex Plan Reviewer rounds (REJECT→APPROVE) + clean branch review. Shipped to `main` 2026-05-20 (`1e68c71`). Server-guard curl checks verified on prod; browser click-through pending.
- [ ] Set OpenAI monthly spend cap on the dedicated MindForum key (defense-in-depth #2)
- [ ] Send faculty invitation for room `ai-ethics-exercise`
- [ ] Collect feedback from first facilitated session; iterate on prompts
- [ ] **2026-05-25 review:** four weeks after MSBAi rooms launch — check usage signal (faculty engagement vs lurking) to decide whether to keep brainstorm framing or convert to a K-ai-activity-mirror digest

## Session Log

### 2026-05-26
- Completed: Postgres migration prep — `pg_dump` from VPS (custom format, no-owner/no-privileges) → SCPed to `~/Downloads/mindforum_20260526_150338.dump` (401K). No code changes.
- Next: Create Azure Flexible Server instance, restore dump, update `POSTGRES_URL` on VPS, redeploy.

### 2026-05-20
- Completed: Shipped **super-admin archive/delete UI on `/admin/rooms`** (`1e68c71`, pushed to `main`, auto-deploy 1m48s). Full brainstorm → spec → plan → implement flow. New per-row Actions column: Archive on active rooms, Restore + type-to-confirm Delete on archived rooms (delete button disabled until the exact room id is typed). New `app/admin/rooms/RoomActions.tsx` client component mirrors the `CopyLinkButton`/`ArchiveControl` fetch→reload pattern. The archived-only hard-delete rule is enforced **atomically inside `hardDeleteRoom`** (`lib/store.ts`) — Codex round-1 caught a TOCTOU race in the original route-level pre-check, so the internal `DELETE` is now conditional on `archived_at IS NOT NULL` and the function returns a discriminated union; `DELETE /api/room/[id]` maps it to `200`/`404 not_found`/`409 not_archived`. 2 Codex Plan Reviewer rounds (REJECT→APPROVE: also fixed wrong audit-log column `created_at`→`at`, and the manual walk now uses `?archived=all` since `/admin/rooms` defaults to the Active filter). Branch `codex review` clean. Server-guard curl checks verified on prod: `DELETE` on active room `a2-QCVJ5m7` → `409 not_archived` (room intact); missing id → `404 not_found`. Spec/plan in `docs/superpowers/{specs,plans}/2026-05-20-*`. Note: subagent-driven execution fell back to inline — subagents failed to dispatch ("prompt too long", they inherit the session's large MCP tool surface).
- Next: Walk Task 4 browser steps 1-4 (archive/restore/delete click-through on `/admin/rooms?archived=all`) with an admin session. Side items still pending: OpenAI monthly spend cap on the global key (defense-in-depth #2), faculty invitation for `ai-ethics-exercise`, 2026-05-25 four-week MSBAi review.

### 2026-05-14
- Completed: Shipped creator-rooms v1 to prod and put a real creator on it. [PR #12](https://github.com/gies-ai-experiments/MindForum/pull/12) (8 commits, ~3.9K LOC). Two codex-review rounds against `main` fixed three real bugs before merge: **R1-P1** middleware imported `CREATOR_COOKIE` from `lib/creator-auth` which transitively pulls `crypto`/`pg`/`next/headers` — would have failed the Edge bundle on prod → extracted to new `lib/creator-cookie.ts` (edge-safe, 7 lines), middleware imports from there, creator-auth re-exports. **R1-P2** `/room/[id]` only opens SSE after `setJoined(true)`, but join now returns 410 for archived rooms → owners following dashboard "Open room" hit a dead end → join handler now detects 410 + actor-is-owner and returns 200 `{readOnly:true, participantId:null}`; existing `state.archived` UI renders the read-only view. **R2-P2** stale creator cookies (rotated/disabled tokens) bypass middleware presence-only gate and 404 on bookmarked settings pages → added `GET /dashboard/auth` that expires cookie + redirects with `err=session_expired`; `/dashboard` server component detects "cookie present + getCreator()=null" and redirects there. Squash-merged as `a8be293`. Auto-deploy ran v6/v7/v8 on live DB (1m5s). Walked all 12 acceptance items end-to-end on prod via curl + psql — every item passed. Provisioned **Ashleyn Castelino** (`ashleyn4@illinois.edu`, id `cr_wBcgR4Eh`, last4 `tAJs`) as the first real creator; token handed off securely, **confirmed sign-in works**. Then wired **Sentry** (`@sentry/nextjs` v10.53, error-only — no traces, no Session Replay, no PII): `instrumentation.ts` register hook + `onRequestError`, `instrumentation-client.ts` for browser, separate `sentry.server.config.ts` + `sentry.edge.config.ts`, single capture point in `lib/creator-auth.ts → httpErrorResponse` for unexpected exceptions (HttpError 4xx not captured); DSN added to VPS `.env.local`. Two CLAUDE.md gotchas landed: `POST /api/room` body field is `id` not `slug` (slug regex `/^[a-z0-9-]{3,40}$/`), and Next 15 server components can't mutate cookies (use a route handler GET to recycle stale cookies). Three learnings persisted to memory: project gotchas to mindforum CLAUDE.md, Next 15 RSC gotcha to global, `codex review --base <branch>` pattern expanded in global codex notes.
- Next: Watch Sentry for first real errors. Watch for Ashleyn's first room creation; gather feedback. Side items still pending: OpenAI monthly spend cap on the global key (defense-in-depth #2), faculty invitation for `ai-ethics-exercise`, 2026-05-25 four-week MSBAi review.

### 2026-05-13
- Completed: Polls & Decisions feature on branch `polls-and-decisions` (off main, originally ignored `creator-rooms-v1` and used migration v6). Rebased onto creator-rooms-v1 main as `polls-and-decisions-v2`; schema v6 → v9. Admin-facilitator UI (close/mute/remove/rename + expandable rows + action modals + brand colors) deliberately skipped at rebase time to avoid clobbering creator-rooms' `/admin/rooms` (Owner column, ACTIVE/ARCHIVED, archived filter); supporting infrastructure (v10 columns: `rooms.closed_at`, `participants.muted_at`/`removed_at`; store fns; admin routes) kept for a follow-up PR. **Live `/poll` highlight** in composer (navy border + bold-navy inline overlay) ported manually from the skipped commit `6b057a1`. **Poll-draft AI now reads the room system prompt** in addition to recent chat history (uses the existing `roomGuidanceBlock` helper, same pattern as `generateBrief` and `chatReplyStream`).
- Schema v9: `polls` + `poll_options` + `poll_votes` with `(poll_id, participant_id)` PK for UPSERT vote-change semantics. Pure-logic module `lib/poll-logic.ts` with 13 passing TDD tests. Store CRUD: `createPoll`, `getPoll`, `getOpenPollsForRoom` (hidden tallies enforced server-side), `getClosedPollsForRoom`, `castVote` (UPSERT tx), `closePoll` (idempotent), `closeExpiredPolls` (lazy-expiry helper invoked at top of `/stream` + `/message` + every poll route). AI: `draftPollFromHistory` (json_schema strict, graceful empty-fallback) called by `POST /poll/draft`; `generateBrief` accepts `closedPolls` and echoes them into `Brief.decisions[]` (post-validated against DB to defeat hallucination). Four new routes under `/api/room/[id]/poll/...` (draft, create, vote, close) rate-limited per `lib/ratelimit.ts`. UI: `PollLaunchModal` (AI draft + edit + 5m/15m/1h/24h/manual duration), `PollCard` (open: hidden tallies + countdown + close-now for author; closed: bars + winner). Three SSE events: `poll_opened`, `poll_vote` (totalVotes only — breakdown hidden), `poll_closed`. Snapshot extended with `openPolls` + `recentClosedPolls`. Brief renderer + markdown serializer get a "Decisions & Votes" section. `requireRoomParticipant` extracted from `/message` + `/upload` for DRY.
- Next: Watch Sentry for first real errors post-deploy. Re-introduce admin-facilitator UI on top of creator-rooms `/admin/rooms` in a follow-up PR.

### 2026-05-10
- Completed: Full v1 creator-rooms implementation on `creator-rooms-v1`. **7 commits this session** on top of the 2026-05-08 foundation (migrations + creator-auth/audit lib): (1) `7d87af9` store extensions — Room.ownerId/archivedAt, getRoomMeta, createRoomBySlug (atomic ON CONFLICT DO NOTHING), archive/restore/transfer/hardDeleteRoom, allowlist CRUD (createCreator/listCreators/rotateCreatorTokenHash/setCreatorDisabled/deleteCreator with FK-RESTRICT room-count check), file/participant snapshot helpers; adminListRoomsWithActivity extended with archived filter + ownerId scope + owner-name join. (2) `69c10f9` API surface — `/api/creator/session`, `/api/creator/me`, `/api/admin/users[/[id][/rotate-token]]`, `/api/admin/rooms/[id]/transfer`, `/api/room/[id]/{archive,restore,route(DELETE+PATCH)}`, DELETE `/api/room/[id]/files/[fileId]`; `/api/room` POST gained dual-auth (header → auto-slug owned by super_admin, cookie → required slug owned by creator); `MAX_SYSTEM_PROMPT_CHARS` 4000 → 51200; soft-delete matrix enforced via `assertActiveRoom` on writes + `assertActiveOrOwnerOnArchive` on reads (catchup, brief, file GET, SSE) with archived-owner participant-cookie bypass; `getActor` reordered to admin-first so an operator with both cookies retains super-admin authority. Audit emitted for every spec action; `AuditActor` widened from Creator to `{id,email}` so participant-scoped actions log too. (3) `fead931` `/dashboard` + middleware gate (`/dashboard/:path+` excluding root + `/dashboard/auth`) + sign-in form + CreateRoomForm with 409-slug-taken UX. (4) `0b1f12d` `/dashboard/rooms/[id]/settings` (General/Files/Participants/Activity sections) + DELETE `/api/room/[id]/participants/[pid]` kick route + **`.gitignore` fix** (unanchored `rooms/` was silently swallowing `app/api/admin/rooms/*` and `app/dashboard/rooms/*` from `git add -A`; changed to `/rooms/`). (5) `6aa13a3` `/admin/users` CRUD page with one-time token reveal modal + `/admin/users/auth` + `/admin/rooms` Owner column + ACTIVE/ARCHIVED badges + Active/Archived/All filter + `/room/[id]` archived banner & composer/upload/brief disable & SSE handlers for `room_archived`/`room_restored`/`participant_removed` & 410 handling on join. Codex review ran 4 rounds before hitting today's usage limit (resets ~11:34 today): R1 0 issues on store layer; R2 caught race in slug claim → fixed with ON CONFLICT DO NOTHING (still in this commit); R3 caught admin-vs-creator cookie priority bug, missing PATCH route, archived-owner participant-401 bug — all fixed; R4 caught room-page UI not consuming archived state — fixed in commit (5).
- Next: Open PR for `creator-rooms-v1` → `main`. Re-run `codex review --base main` once the limit resets and act on findings. Merge — auto-deploy will pull, run `npm run migrate` (v6/v7/v8 land on the live DB), build, restart pm2. Then walk the 12-item Acceptance Checklist on the deployed VPS: re-run migrations to confirm rerun-safe, exercise creator sign-in / room create / 409-slug / cross-owner 404 / archive matrix / transfer / disable / rotate / audit log surface / hard-delete. Provision the first real creator via `/admin/users` once verified. Side items still pending from prior sessions: OpenAI monthly spend cap, faculty invitation for `ai-ethics-exercise`, 2026-05-25 four-week MSBAi review.

### 2026-05-08
- Completed: Started v1 creator-owned rooms on branch `creator-rooms-v1` (off `main`). Two commits: (1) `4cf2d31` migrations v6/v7/v8 — `allowlisted_creators` table with synthetic `cr_super_admin` row (sentinel token_hash = 64 zeros, unreachable by sha256), `rooms.owner_id` (FK ON DELETE RESTRICT) + `archived_at`, append-only `audit_log` (no FK on room_id so entries survive hard-delete). Verified rerun-safe + backfill against a throwaway DB on VPS (`mindforum_migrate_test`, dropped after). (2) `ff67f30` `lib/creator-auth.ts` (token hashing, constant-time compare, getCreator/getActor/requireCreator/checkRoomOwner) + `lib/audit.ts` (append-only logAudit, listAuditForRoom/Actor) + `lib/store.ts` patch defaulting `owner_id='cr_super_admin'` in `createRoom` and `adminUpsertRoom`. Codex review caught the missing-default P1 (every legacy room create would have failed post-deploy with NULL `owner_id`); fixed before commit.
- Next: Continue on `creator-rooms-v1` — extend `lib/store.ts` with creator CRUD + ownership filters + archive-state checks; add new routes (`/api/creator/session`, `/api/creator/me`, `/api/admin/users[...]`, archive/restore/transfer); modify `/api/room` for dual-auth + slug validation; build pages (`/dashboard`, `/dashboard/rooms/[id]/settings`, `/admin/users`); add middleware gate for `/dashboard/*`. Bump `MAX_SYSTEM_PROMPT_CHARS` from 4000 → 51200 per spec decision #2 when the route is touched. Branch is **not** merged to `main` yet, so auto-deploy hasn't fired and the migrations haven't run on the live DB — that's part of the merge step.
