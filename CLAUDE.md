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
- **Renaming a room id orphans cookies.** Browser sessions store `mindforum_pid_<roomid>`; if you rename the room PK (insert-new → repoint children → delete-old transaction), users who joined the old id can't auth into the new id and must re-join. No FK ON UPDATE CASCADE on schema. Only safe before invitations go out.

## Room configs

Per-room setup artifacts live under `rooms/YYYY-MM-DD-<slug>/`:
- `README.md` — room setup checklist
- `facilitator-system-prompt.md` — AI guidance to paste at room creation
- other supporting files (source transcripts, draft prompts, etc.) — uploaded to the room

## Current Focus

Verify creator-rooms v1 against the spec's Acceptance Checklist on staging/prod. Branch `creator-rooms-v1` is code-complete (8 commits ahead of main, pushed); merging to main will auto-deploy and run migrations v6/v7/v8. Open the v1 PR, run a final `codex review --base main` once the limit resets, walk the 12-item Acceptance Checklist on the deployed VPS, then provision the first real creator via `/admin/users` and smoke-test create + edit + archive + transfer. Side items: OpenAI monthly spend cap, faculty invitation for `ai-ethics-exercise`.

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
- [x] **Implement v1 creator-owned rooms** per `docs/plans/2026-05-07-creator-rooms-v1-min.md` — code complete on `creator-rooms-v1` (8 commits, ~3.5K lines): migrations v6/v7/v8, store extensions (owner/archive/allowlist CRUD), API surface (creator session, admin users, archive/transfer/hard-delete, dual-auth `/api/room`), `/dashboard` + sign-in + create form, `/dashboard/rooms/[id]/settings` (general/files/participants/activity), middleware gate, `/admin/users` CRUD with one-time token reveal, `/admin/rooms` Owner column + status filter, `/room/[id]` archived banner + composer hide, participant kick route. Pushed; not merged yet.
- [ ] **Verify creator-rooms v1 against Acceptance Checklist on the deployed VPS** — open PR for `creator-rooms-v1` → `main`, final `codex review --base main`, merge to trigger auto-deploy + migrations, then walk all 12 acceptance items on production.
- [ ] Set OpenAI monthly spend cap on the dedicated MindForum key (defense-in-depth #2)
- [ ] Send faculty invitation for room `ai-ethics-exercise`
- [ ] Collect feedback from first facilitated session; iterate on prompts
- [ ] **2026-05-25 review:** four weeks after MSBAi rooms launch — check usage signal (faculty engagement vs lurking) to decide whether to keep brainstorm framing or convert to a K-ai-activity-mirror digest

## Session Log

### 2026-05-10
- Completed: Full v1 creator-rooms implementation on `creator-rooms-v1`. **7 commits this session** on top of the 2026-05-08 foundation (migrations + creator-auth/audit lib): (1) `7d87af9` store extensions — Room.ownerId/archivedAt, getRoomMeta, createRoomBySlug (atomic ON CONFLICT DO NOTHING), archive/restore/transfer/hardDeleteRoom, allowlist CRUD (createCreator/listCreators/rotateCreatorTokenHash/setCreatorDisabled/deleteCreator with FK-RESTRICT room-count check), file/participant snapshot helpers; adminListRoomsWithActivity extended with archived filter + ownerId scope + owner-name join. (2) `69c10f9` API surface — `/api/creator/session`, `/api/creator/me`, `/api/admin/users[/[id][/rotate-token]]`, `/api/admin/rooms/[id]/transfer`, `/api/room/[id]/{archive,restore,route(DELETE+PATCH)}`, DELETE `/api/room/[id]/files/[fileId]`; `/api/room` POST gained dual-auth (header → auto-slug owned by super_admin, cookie → required slug owned by creator); `MAX_SYSTEM_PROMPT_CHARS` 4000 → 51200; soft-delete matrix enforced via `assertActiveRoom` on writes + `assertActiveOrOwnerOnArchive` on reads (catchup, brief, file GET, SSE) with archived-owner participant-cookie bypass; `getActor` reordered to admin-first so an operator with both cookies retains super-admin authority. Audit emitted for every spec action; `AuditActor` widened from Creator to `{id,email}` so participant-scoped actions log too. (3) `fead931` `/dashboard` + middleware gate (`/dashboard/:path+` excluding root + `/dashboard/auth`) + sign-in form + CreateRoomForm with 409-slug-taken UX. (4) `0b1f12d` `/dashboard/rooms/[id]/settings` (General/Files/Participants/Activity sections) + DELETE `/api/room/[id]/participants/[pid]` kick route + **`.gitignore` fix** (unanchored `rooms/` was silently swallowing `app/api/admin/rooms/*` and `app/dashboard/rooms/*` from `git add -A`; changed to `/rooms/`). (5) `6aa13a3` `/admin/users` CRUD page with one-time token reveal modal + `/admin/users/auth` + `/admin/rooms` Owner column + ACTIVE/ARCHIVED badges + Active/Archived/All filter + `/room/[id]` archived banner & composer/upload/brief disable & SSE handlers for `room_archived`/`room_restored`/`participant_removed` & 410 handling on join. Codex review ran 4 rounds before hitting today's usage limit (resets ~11:34 today): R1 0 issues on store layer; R2 caught race in slug claim → fixed with ON CONFLICT DO NOTHING (still in this commit); R3 caught admin-vs-creator cookie priority bug, missing PATCH route, archived-owner participant-401 bug — all fixed; R4 caught room-page UI not consuming archived state — fixed in commit (5).
- Next: Open PR for `creator-rooms-v1` → `main`. Re-run `codex review --base main` once the limit resets and act on findings. Merge — auto-deploy will pull, run `npm run migrate` (v6/v7/v8 land on the live DB), build, restart pm2. Then walk the 12-item Acceptance Checklist on the deployed VPS: re-run migrations to confirm rerun-safe, exercise creator sign-in / room create / 409-slug / cross-owner 404 / archive matrix / transfer / disable / rotate / audit log surface / hard-delete. Provision the first real creator via `/admin/users` once verified. Side items still pending from prior sessions: OpenAI monthly spend cap, faculty invitation for `ai-ethics-exercise`, 2026-05-25 four-week MSBAi review.
