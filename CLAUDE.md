# MindForum

Shared AI brainstorming room app for small faculty groups. Next.js 15 + SSE + Postgres.

## Key paths

| | |
|---|---|
| Prod URL | (private — see `~/.claude/projects/-Users-vishal-research-mindforum/memory/`) — **now served by Azure** (cut over 2026-06-08) |
| Azure app | App Service `mindforum`, RG `DL_ResourceGroup_01`, sub `urbana-business-disruptionlab`, North Central US; host `mindforum.azurewebsites.net`. Deploy via `main_mindforum.yml`. |
| Azure DB | Postgres Flexible Server `dl-postgresqlserver-01.postgres.database.azure.com`, db **`mindforum`** (NOT the default `postgres` db — that's a system default, never touch it). Migrate with `POSTGRES_URL=<mindforum-conn-str> npm run migrate`. |
| Azure OpenAI | endpoint `dl-foundry-mindforum.openai.azure.com`; models routed FAST/DEFAULT=`gpt-4.1`, STRONG=`gpt-5.4` (see `lib/model-routing.ts`) |
| VPS (rollback) | `/root/repos/mindforum` (ssh alias `vps`), PM2 `mindforum` port 3006, Postgres role/db `mindforum` localhost:5432. Still running + still auto-deployed; rollback = flip CF record back to proxied `A → 76.13.122.44` (null worker route left in place for this). |
| Repo | `gies-ai-experiments/MindForum` (public, MIT; deploy key `mindforum_deploy` on VPS) |

**Azure rule**: ANY task involving database migrations, cloud deployment, App Service configuration, PostgreSQL operations, DNS, or Entra ID auth → **ALWAYS consult the Azure skills first**: `illinois-azure-cli-deploy` (commands), `illinois-azure-app-migration` (topology/planning), `illinois-azure-governance` (guardrails). Never run `az` commands or touch Azure resources without loading these skills.

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
- **Room system prompts are hard-capped at 4000 characters, and two of three surfaces truncate SILENTLY.** Seed endpoint (`app/api/admin/seed/route.ts`) does `.slice(0, 4000)` and returns `ok: true`; the create-room UI uses `maxLength={4000}` with no counter; only the admin PATCH route rejects with 400. Guardrails sections live at the end of prompts, so truncation cuts exactly the safety text. After seeding or editing any room, verify the deployed prompt length matches the source. Long-form prompt docs are canonical sources, not paste-in blocks — deploy condensed <4000-char versions (pattern: msba-online `docs/mindforum-faculty-system-prompt.md`). Also: `rooms/seed-msba-rooms.py extract_prompt()` grabs the largest ``` fence, so prompts containing code fences seed the wrong fragment (issue #21) — keep room prompt files fence-free until fixed. Open issues: #20 (silent truncation), #21 (fence parsing).

## Room configs

Per-room setup artifacts live under `rooms/YYYY-MM-DD-<slug>/`:
- `README.md` — room setup checklist
- `facilitator-system-prompt.md` — AI guidance to paste at room creation
- other supporting files (source transcripts, draft prompts, etc.) — uploaded to the room

## Current Focus

Creator-rooms v1 is live with the first real creator signed in (Ashleyn Castelino). Sentry is wired. **Azure migration DNS cutover is DONE (2026-06-08):** `mindforum.illinihunt.org` now resolves DNS-only (grey-cloud) `CNAME → mindforum.azurewebsites.net` with an App Service managed cert (SNI, GeoTrust, exp 2026-12-09); Azure app + restored DB (17 rooms) + Azure OpenAI all verified healthy on the live domain. Tracked in issue [#22](https://github.com/gies-ai-experiments/MindForum/issues/22). **PR #25 (room invitations + dashboard redesign + Entra SSO) shipped 2026-06-15** — 4-round codex review (14 fixes), validated on the staging slot and **Entra SSO verified live on prod** (`mindforum.disruptionlab.illinois.edu`). **VPS auto-deploy retired** — `deploy.yml` deleted (`2c3df35`); the VPS box stays running as a manual one-step DNS rollback, not decommissioned. The prod-deploy "succeeds but running app not updated" bug was the Azure package not being zipped — fixed in `a74b45c`. The `feat-polls-and-decisions_mindforum(staging)` workflow is **NOT orphaned** — it deploys the `test` branch to the Azure staging slot. Watch for usage + Sentry alerts; gather feedback before v2 (per-creator OpenAI keys + spend caps + usage events). Other side items: OpenAI monthly spend cap (defense-in-depth #2), faculty invitation for `ai-ethics-exercise`, overdue four-week MSBAi review (was 2026-05-25).

## Auto-deploy

**Primary (prod) = Azure App Service.** Push to `main` → `main_mindforum.yml` builds the Next standalone app and deploys to the Production slot. `test` branch → `feat-polls-and-decisions_mindforum(staging).yml` → Azure **staging slot** (`mindforum-staging.azurewebsites.net`, used to validate changes before merge). ⚠️ **Gotcha:** the prod deploy once "succeeded" while the running app kept serving a stale build — the standalone package wasn't being zipped before upload (fixed `a74b45c`). After any prod deploy, verify the served Next `buildId` actually changed (`curl …/dashboard | grep buildId`) and `/api/auth/providers` returns 200, not 404.

**VPS = retired.** `deploy.yml` was deleted (`2c3df35`); the VPS no longer auto-deploys. The box stays running purely as a manual **DNS rollback** target (flip the live domain's CNAME/record back to the VPS). Ad-hoc shell access via `ssh vps` (`~/.ssh/id_ed25519`); `scripts/deploy.sh` still exists on the box for a manual refresh if ever needed.

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
- [x] Creator-owned rooms design spec + v1-minimum trim — 3 rounds Codex Plan Reviewer, APPROVED, merged via [PR #11](https://github.com/gies-ai-experiments/MindForum/pull/11).
- [x] **Implement v1 creator-owned rooms** — code complete on `creator-rooms-v1` (8 commits, ~3.5K lines): migrations v6/v7/v8, store extensions (owner/archive/allowlist CRUD), API surface (creator session, admin users, archive/transfer/hard-delete, dual-auth `/api/room`), `/dashboard` + sign-in + create form, `/dashboard/rooms/[id]/settings` (general/files/participants/activity), middleware gate, `/admin/users` CRUD with one-time token reveal, `/admin/rooms` Owner column + status filter, `/room/[id]` archived banner + composer hide, participant kick route. Merged via PR #12.
- [x] **Verify creator-rooms v1 against Acceptance Checklist on the deployed VPS** — [PR #12](https://github.com/gies-ai-experiments/MindForum/pull/12) merged 2026-05-13. Two codex-review rounds against `main` (P1 edge-runtime middleware import bleed → extracted `lib/creator-cookie.ts`; P2 archived-owner can't view room → join returns 200 + `readOnly` for owners; P2 stale creator cookie not cleared → `GET /dashboard/auth` recycles). Auto-deploy ran v6/v7/v8 on live DB. All 12 acceptance items walked end-to-end on prod via curl + psql; first creator (Ashleyn Castelino) provisioned.
- [x] **Polls & Decisions v1** — `/poll` command with AI option draft (grounded in recent chat + room system prompt), single-choice hidden-tally voting (5m/15m/1h/24h/manual), lazy expiry, automatic inclusion in project brief's new "Decisions & Votes" section. Live composer highlight (navy border + bold-navy `/poll` overlay) mirrors the existing `@ai` orange pattern. Rebased onto `creator-rooms-v1` main as `polls-and-decisions-v2`; migration renumbered v6 → v9. Admin-facilitator UI (close/mute/remove/rename + expandable rows) deliberately skipped from the merge — supporting infrastructure (v10 columns, store fns, routes) is in for a follow-up PR.
- [x] **Super-admin archive/delete UI on `/admin/rooms`** — per-row Actions column (Archive on active rooms; Restore + type-to-confirm Delete on archived). `hardDeleteRoom` enforces archived-only atomically (conditional `DELETE … WHERE archived_at IS NOT NULL`); `DELETE /api/room/[id]` returns `409 not_archived` / `404 not_found`. Spec + plan in `docs/superpowers/`, 2 Codex Plan Reviewer rounds (REJECT→APPROVE) + clean branch review. Shipped to `main` 2026-05-20 (`1e68c71`). Server-guard curl checks verified on prod; browser click-through pending.
- [ ] Set OpenAI monthly spend cap on the dedicated MindForum key (defense-in-depth #2)
- [ ] Send faculty invitation for room `ai-ethics-exercise`
- [ ] Collect feedback from first facilitated session; iterate on prompts
- [ ] **2026-05-25 review:** four weeks after MSBAi rooms launch — check usage signal (faculty engagement vs lurking) to decide whether to keep brainstorm framing or convert to a K-ai-activity-mirror digest

## Session Log

### 2026-06-09
- Completed: **Azure DNS cutover — `mindforum.illinihunt.org` now serves from Azure App Service** (was VPS). Pulled + reviewed Ash's 5 Azure commits (Azure OpenAI client + task-complexity model routing; clean, backward-compatible — legacy `OPENAI_MODEL` fallback keeps the VPS untouched). Installed Azure CLI + user web-auth (sub `urbana-business-disruptionlab`, app `mindforum` / RG `DL_ResourceGroup_01`). Cutover: added `asuid.mindforum` ownership TXT = `customDomainVerificationId`; bound the hostname (Verified, non-disruptive); flipped the Cloudflare record from proxied `A → 76.13.122.44` to **DNS-only CNAME → mindforum.azurewebsites.net**; issued + SNI-bound an App Service **managed cert** (GeoTrust, exp 2026-12-09; ~1–2 min TLS gap, no live traffic). Verified live HTTPS clean + **DB restore real (17 rooms present)** + Azure OpenAI wired (gpt-4.1 fast/default, gpt-5.4 strong). Posted cutover status on [#22](https://github.com/gies-ai-experiments/MindForum/issues/22). VPS left running as one-step rollback (null worker route retained). Then **distilled the reusable Azure migration knowledge** (compared this App-Service migration vs illinihunt's Static-Web-Apps one) into `~/admin/agent-infra/azure-deployment.md` + a `~/.claude/references/` pointer — repo-agnostic playbook (service fork, the two domain-validation flows, the cert-sequencing rule, Cloudflare DNS-only pattern). Commits: mindforum `cf33ee6` (pushed), agent-infra `04e57ed`, ~/.claude `1164f3e`.
- Next: **Remaining #22 cleanup after Azure soaks** — retire the VPS deploy (`scripts/deploy.sh`) + the orphaned `feat-polls-and-decisions_mindforum(staging)` workflow (pushes to `main` still double-deploy VPS+Azure; the VPS half failed today on the recurring transient SSH `i/o timeout` — harmless, deploy never ran, VPS unchanged). Then decommission the VPS. Still-pending side items: OpenAI monthly spend cap (defense-in-depth #2), faculty invitation for `ai-ethics-exercise`, the **overdue MSBAi four-week review** (was 2026-05-25).
