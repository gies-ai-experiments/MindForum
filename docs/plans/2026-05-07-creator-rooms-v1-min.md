# Creator-Owned Rooms — v1 Minimum

**Date:** 2026-05-07
**Branch:** `claude/room-management-spec-j4Myh`
**Status:** Design draft — pending review
**Supersedes:** `2026-05-07-creator-rooms-design.md` (kept as v2 reference for deferred items)

## Why this revision

The first design was right in direction but wrong in size: 4 tables, ~25 endpoints, encryption + caps + usage tracking + elevation flow shipped together. For an app with ~6 active rooms and one operator today, that's months of work and a lot of failure surface to ship at once. This v1 strips to the minimum that delivers the actual goal — allowlisted faculty self-serving their own rooms — and defers anything that isn't load-bearing for that goal.

## Goal (v1)

A small set of allowlisted faculty ("creators") can sign in with a token, create rooms, and CRUD their own rooms (name, system prompt, files, participants, archive/restore). Super-admin manages the allowlist and retains full visibility over rooms (no privacy gate in v1).

## Non-Goals (v1)

- Per-creator OpenAI API keys → **v2**.
- App-level spend caps → **v2**. (Provider-level OpenAI project budget remains the hard guarantee.)
- Usage / $ tracking, sparklines, dashboards beyond row counts → **v2**.
- Privacy elevation flow with in-room banner → **v2**.
- Email masking in admin views → **v2**.
- AES-GCM key encryption → **v2** (no creator-specific secrets in v1).
- Co-owners / shared rooms, SSO, OAuth → out of scope entirely.

The full deferred-item list lives at the bottom of the original spec; this doc only covers what ships.

## Personas

| Persona | Auth | Surfaces | Capabilities |
|---|---|---|---|
| Super-admin | `ADMIN_TOKEN` cookie (existing) | `/admin/rooms`, `/admin/users` | Manage allowlist; see every creator and every room; rotate any creator's token; transfer or hard-delete rooms. |
| Creator | Per-creator hashed token cookie | `/dashboard`, `/dashboard/rooms/[id]/settings` | Create rooms; CRUD their own (name, system prompt, files, participants, archive/restore). |
| Participant | `mindforum_pid_<roomid>` (existing) | `/room/<id>` | Unchanged. Joining or posting in an archived room is blocked. |

## Architecture Overview

```
app/
  dashboard/                       NEW
    page.tsx                            list rooms + create form
    auth/route.ts                       POST token paste → set cookie
    rooms/[id]/settings/page.tsx        per-room CRUD UI
  admin/
    rooms/                              existing — extend with owner column + filter
    users/                         NEW
      page.tsx                          allowlist CRUD
      auth/route.ts
  api/
    room/route.ts                  MODIFY  accept creator-token in addition to admin-token
    room/[id]/                     MODIFY  ownership-scoped guards on PATCH/DELETE/file/participant
    creator/                       NEW
      session/route.ts                  POST/DELETE
      me/route.ts                       GET profile
    admin/
      users/route.ts               NEW    list/create
      users/[id]/route.ts          NEW    update/disable/rotate-token/delete
      rooms/[id]/transfer/route.ts NEW    super-admin reassigns owner
lib/
  creator-auth.ts                  NEW    hashing, cookie helpers, requireRoomOwner
  audit.ts                         NEW    append-only log helper
  store.ts                         add: creator CRUD, ownership filters, audit writes
db/
  schema.sql                       new migrations v6, v7, v8
middleware.ts                      gate /dashboard/* on creator cookie; /admin/* unchanged
```

No encryption module, no usage_events, no elevation table, no blocklist (kick = remove participant; rejoin block deferred to v2 with an explicit blocklist when actually needed).

## Data Model

### v6 — `allowlisted_creators`

```sql
CREATE TABLE IF NOT EXISTS allowlisted_creators (
  id                TEXT PRIMARY KEY,            -- e.g. "cr_a1b2c3"
  email             TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  token_hash        TEXT NOT NULL,               -- sha256 hex of the plaintext
  token_last_four   TEXT NOT NULL,
  token_rotated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_super_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS allowlisted_creators_email_uniq
  ON allowlisted_creators (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS allowlisted_creators_token_hash_uniq
  ON allowlisted_creators (token_hash);
```

A single synthetic super-admin row is inserted at migration time with **fixed values** (so the migration is rerun-safe and the row is always findable by id):

```sql
INSERT INTO allowlisted_creators (
  id, email, display_name, token_hash, token_last_four,
  is_super_admin, created_at, created_by
) VALUES (
  'cr_super_admin',                                                       -- fixed primary key
  'super_admin@mindforum.local',                                          -- sentinel email, not the operator's real address
  'Super Admin',
  '0000000000000000000000000000000000000000000000000000000000000000',     -- 64-hex sentinel; never matches a real sha256(token)
  '0000',
  TRUE, NOW(), 'system'
)
ON CONFLICT (id) DO NOTHING;
```

The token-hash sentinel is intentionally an unreachable value so no plaintext token can ever authenticate as the super-admin row — super-admin still authenticates via `ADMIN_TOKEN`; this row exists only so foreign keys and audit-log entries have a valid `actor_id`. Sentinel email keeps audit log readability honest (entries don't masquerade as the operator's real account).

### v7 — `rooms` extensions

```sql
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS owner_id    TEXT REFERENCES allowlisted_creators(id) ON DELETE RESTRICT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Backfill is now safe to re-run because the synthetic row has a fixed id.
-- Using the literal id (not a subquery) avoids the "0 or >1 super-admin rows" failure mode.
UPDATE rooms SET owner_id = 'cr_super_admin' WHERE owner_id IS NULL;
ALTER TABLE rooms ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS rooms_owner_idx ON rooms (owner_id);
CREATE INDEX IF NOT EXISTS rooms_archived_idx ON rooms (archived_at) WHERE archived_at IS NULL;
```

`ON DELETE RESTRICT` on `owner_id` is intentional: deleting a creator with rooms requires explicit transfer or hard-delete. Legacy `created_by_id` stays for now (it points to a participants row and is used elsewhere); flag for a follow-up grep + cleanup once the new column has settled.

### v8 — `audit_log`

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id    TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  room_id     TEXT,
  metadata    JSONB
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_room_idx  ON audit_log (room_id, at DESC);
```

Append-only by convention. v1 actions and metadata captured per action:

| Action | Metadata |
|---|---|
| `allowlist.create` | `{ creatorEmail, creatorDisplayName }` |
| `allowlist.update` | `{ field: { from, to } }` (e.g. displayName) |
| `allowlist.disable`, `allowlist.enable` | `{ creatorEmail }` |
| `allowlist.rotate_token` | `{ creatorEmail }` (no token values, ever) |
| `allowlist.delete` | `{ creatorEmail }` |
| `room.create` | `{ slug, name, ownerId }` |
| `room.update` | `{ name?: { from, to } }` — system-prompt changes captured as `systemPromptLen: { from, to }` only (length, not content; full content lives in the `rooms` row) |
| `room.archive`, `room.restore` | `{}` (room_id carries the rest) |
| `room.hard_delete` | `{ slug, name, ownerId, messageCount, fileCount }` (snapshot before cascade) |
| `room.transfer` | `{ fromOwnerId, toOwnerId }` |
| `participant.kick` | `{ participantEmail, participantName, joinedAt }` (captured before delete) |
| `file.upload` | `{ fileId, fileName, sizeBytes, mime }` |
| `file.delete` | `{ fileId, fileName, sizeBytes }` (captured before delete) |
| `file.toggle_selected` | `{ fileId, selected }` |

No diffs-as-hashes in v1; system-prompt content is not duplicated into the audit log (the row in `rooms` is the source of truth — if a creator wants to revert a prompt edit, that's a v2 affordance). Lengths are kept so the activity feed can show "system prompt: 1,200 → 1,650 chars" without an extra query.

## Auth Model

### Creator token

- 32 bytes from `crypto.randomBytes`, base64url-encoded (~43 chars).
- Plaintext shown to super-admin once at creation/rotation; DB stores `sha256(plaintext)` + last-4.
- Verification: `crypto.timingSafeEqual(sha256(cookie_value), token_hash)`. Constant-time comparison.

### Cookie

```
mindforum_creator_session   HttpOnly, Secure (prod), SameSite=Lax, Path=/, Max-Age=1y
```

Value = the plaintext token; server hashes per request to look up the row. No separate session id — the cookie is the credential.

Sign-in: super-admin shares token out of band → creator visits `/dashboard` → token-paste form → `POST /api/creator/session` → cookie set. Sign-out: `DELETE /api/creator/session`.

Disabled creators: `disabled_at IS NOT NULL` rejects every authenticated request with 401 and clears the cookie. The creator's existing rooms keep functioning under the same `owner_id` (super-admin retains visibility). If the creator was using the global OpenAI key (v1 has no per-creator keys), `@ai` keeps working in those rooms; this is the only sensible resolution for v1.

### Ownership guard

```ts
// lib/creator-auth.ts
export async function requireRoomOwner(req: Request, roomId: string): Promise<{ creator; room }> {
  const creator = await requireCreator(req);                  // 401 if no/invalid cookie or disabled
  const room = await getRoom(roomId);                         // 404 if missing
  if (!creator.isSuperAdmin && room.ownerId !== creator.id) {
    throw new HttpError(404, "not_found");                    // 404 not 403 — don't leak existence
  }
  return { creator, room };
}
```

### Super-admin

Existing `ADMIN_TOKEN` cookie path is unchanged. Internally treated as "creator with `is_super_admin = TRUE`, no ownership constraint." `ADMIN_TOKEN` is matched separately from creator-token verification — a bug in creator auth cannot escalate.

## API Surface (v1)

### Creator session

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `POST` | `/api/creator/session` | Body `{ token }` | Validate → set cookie → return `{ id, email, displayName }`. |
| `DELETE` | `/api/creator/session` | Cookie | Clear cookie. 204. |
| `GET` | `/api/creator/me` | Cookie | Return profile. |

### Rooms — `POST /api/room` dual-auth posture

The existing `POST /api/room` is preserved unchanged, and a creator-cookie path is added alongside it. Two distinct call shapes:

**Legacy / admin path (unchanged, keeps homepage working):**
- Auth: `x-admin-token` request header matching `ADMIN_TOKEN`.
- Body: `{ name, systemPrompt? }` — no `id`.
- Server generates a random `nanoid(10)` slug as today.
- Owner is the synthetic super-admin row.
- Used by the homepage form (`app/page.tsx`) and any existing scripts.

**New creator path:**
- Auth: `mindforum_creator_session` cookie. Creator-only by construction (the synthetic super-admin row's sentinel token_hash cannot match any real sha256(token), so super-admin can never authenticate via this cookie).
- Body: `{ id, name, systemPrompt? }` — `id` REQUIRED, `[a-z0-9-]{3,40}`.
- Slug uniqueness is global, first-come-first-served. On collision, return:
  ```json
  { "error": "slug_taken", "ownerDisplayName": "Priya Singh" }
  ```
  with HTTP 409. UI surfaces "that slug is taken by Priya Singh — try another."
- Owner is always the authenticated creator. No `ownerId` override.
- Used by `/dashboard` create form.

Auth resolution order in the route: header first (legacy admin), then cookie (creator). If both are present, the header wins so scripts are deterministic. The two paths are otherwise independent — admin path always auto-generates the slug, creator path always requires it. Rate limit is per-IP for both; the creator path also enforces per-creator-id daily caps.

Super-admin who wants to create a room *owned by a specific creator* uses the two-step path: legacy header create (room owned by `cr_super_admin`) → `POST /api/admin/rooms/[id]/transfer` to reassign. This avoids duplicating room-create logic and matches the existing transfer endpoint.

### Rooms (other endpoints, all extend existing handlers)

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `PATCH` | `/api/room/[id]` | `requireRoomOwner` | Update name + systemPrompt. Audited. |
| `POST` | `/api/room/[id]/archive` | `requireRoomOwner` | `archived_at = NOW()`. Idempotent. Audited. |
| `POST` | `/api/room/[id]/restore` | `requireRoomOwner` | `archived_at = NULL`. Audited. |
| `DELETE` | `/api/room/[id]` | Super-admin only | Hard delete. Cascades. Audited. |
| `DELETE` | `/api/room/[id]/participants/[pid]` | `requireRoomOwner` | Remove participant. Audited (`participant.kick`, metadata: `{ participantEmail, participantName, joinedAt }`). No blocklist in v1 — removed users can rejoin if they have the link. |
| `POST` | `/api/room/[id]/upload` | Existing participant cookie (unchanged); creators use the in-room upload widget after joining their room | Existing handler. Audited as `file.upload` (metadata: `{ fileId, fileName, sizeBytes, mime }`). The audit row is written from the existing handler — only requires adding the audit call, not new auth logic. |
| `POST` | `/api/room/[id]/files` (toggle selection) | Existing participant cookie (unchanged) | Existing handler — body `{ fileId, selected }`. Sets the "include in AI context" flag. Audited as `file.toggle_selected` (metadata: `{ fileId, selected }`). |
| `GET` | `/api/room/[id]/files/[fid]` (preview) | Existing participant cookie (unchanged) | Returns extracted text for a single file. Read-only; not audited. |
| `DELETE` | `/api/room/[id]/files/[fid]` | `requireRoomOwner` | **NEW endpoint.** Deletes a file. The current app has no delete-file UX; the creator settings page introduces it. Audited (`file.delete`, metadata: `{ fileId, fileName, sizeBytes }`, captured before delete). |

### Admin / allowlist

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/api/admin/users` | Admin cookie | List creators (display name, email, room count, status, token last-4). |
| `POST` | `/api/admin/users` | Admin cookie | Body `{ email, displayName }` → generate token → return plaintext **once**. |
| `PATCH` | `/api/admin/users/[id]` | Admin cookie | Update displayName, disable/enable. |
| `POST` | `/api/admin/users/[id]/rotate-token` | Admin cookie | New token, return plaintext once, old hash invalidated. |
| `DELETE` | `/api/admin/users/[id]` | Admin cookie | Refused if creator owns rooms (UX prompts to disable or transfer). |
| `POST` | `/api/admin/rooms/[id]/transfer` | Admin cookie + body `{ ownerId }` | Reassign room ownership. Audited. |

### Public room reads

`/api/room/[id]/...` *read* endpoints get one new check: if `archived_at IS NOT NULL`, return 410 Gone for non-owners; 200 with a read-only flag for owner / super-admin (so they can review before restoring). Joins, posts, uploads, reactions: 410 outright.

## UI

### `/dashboard` (creator)

Server component. No cookie → token-paste form. Cookie → page with two sections:

1. **Your rooms** — table filtered to `owner_id = me`. Columns: name, status (active/archived), last activity, message count, participant count, file count. Row actions: open room, open settings, archive/restore, copy share link.
2. **Create room** — slug (live validation + uniqueness ping → 409 surfaces here), display name, system prompt textarea. Submit → `POST /api/room` → redirect to settings.

Header strip: `email · ends in …aB7c · Sign out`.

### `/dashboard/rooms/[id]/settings` (creator)

Tabbed page. Server-side `requireRoomOwner`.

- **General** — name, system prompt, archive/restore (with confirm).
- **Files** — list + selection toggle + delete + upload.
- **Participants** — list + remove (no blocklist in v1).
- **Activity** — last 50 audit-log entries scoped to this room.

### `/admin/rooms` (extended)

Existing table gets one new column: **Owner** (display name → `/admin/users#cr_xxx`) and a status column (active/archived). Filter `?archived=true|false|all` (default `false`). No "$ this month," no key source, no sparklines — those are v2.

### `/admin/users`

CRUD for the allowlist. Table: display name, email, room count, last activity, status, token last-4. Row actions:

- **Create** — modal asks email + display name; server returns plaintext token; UI shows one-time reveal panel with copy button + warning. Closing destroys the value in browser memory.
- **Rotate token** — same one-time reveal flow; old token stops working immediately.
- **Disable / Enable** — toggle `disabled_at`.
- **Delete** — disabled when room count > 0 (tooltip: "transfer rooms first").

## Soft-Delete Semantics

The current app has no separate snapshot endpoint — the snapshot ships in the SSE init event from `GET /api/room/[id]/stream`. The matrix below covers every existing route under `app/api/room/[id]/...` plus the page render. "Owner" = `requireRoomOwner` returns OK (room owner or super-admin).

| Endpoint | Active | Archived (non-owner) | Archived (owner) |
|---|---|---|---|
| `GET /room/[id]` (page) | render | 404 | render with banner "Archived — restore to reopen", composer hidden |
| `GET /api/room/[id]/stream` (SSE; init snapshot + live events) | streams | 410 | streams the snapshot once, then `archived: true` flag on the init event; no further live events broadcast (room is frozen) |
| `POST /api/room/[id]/join` | 200 | 410 | 410 |
| `POST /api/room/[id]/message` | 200 | 410 | 410 |
| `PATCH /api/room/[id]/message/[msgId]` (edit) | 200 | 410 | 410 |
| `POST /api/room/[id]/message/[msgId]/react` | 200 | 410 | 410 |
| `POST /api/room/[id]/upload` (file upload) | 200 | 410 | 410 |
| `POST /api/room/[id]/files` (toggle file `selected`) | 200 | 410 | 410 |
| `GET /api/room/[id]/files/[fid]` (preview / extracted text) | 200 | 410 | 200 (owner/super-admin can review history) |
| `DELETE /api/room/[id]/files/[fid]` (NEW route) | 200 (`requireRoomOwner`) | 410 | 410 (no edits to archived rooms; restore first) |
| `POST /api/room/[id]/catchup` | 200 | 410 | 200 (read-only summary still useful) |
| `POST /api/room/[id]/brief` | 200 | 410 | 200 (download brief of the archived conversation) |
| `POST /api/room/[id]/archive` | 200 (`requireRoomOwner`) | 200 (idempotent no-op) | 200 (idempotent no-op) |
| `POST /api/room/[id]/restore` | n/a (no-op on active) | 410 | 200 (`requireRoomOwner`) |

Behavior rationale: archived rooms are frozen but still readable to owner/super-admin so they can review history before deciding to restore or hard-delete. Catch-up and brief endpoints stay open for owners specifically because the most common reason to look at an archived room is to grab its summary. Edits and writes are uniformly blocked even for the owner — the contract is "restore first, then edit."

Cookies for participants in a since-archived room are not invalidated — restoring the room brings them back with their existing identity.

## Rate Limits

Existing `POST /api/room` 5/10min per IP — keep. Add per-creator-id caps so one misbehaving creator on a shared IP can't drown out others:

| Endpoint | Per-IP | Per-creator |
|---|---|---|
| `POST /api/room` | 5 / 10 min | 20 / day |
| `PATCH /api/room/[id]` | n/a | 60 / hour |
| `POST /api/creator/session` | 10 / min | n/a |

In-memory like the existing limiter; resets on process restart.

## Security Checklist (v1 surface only)

1. Hashed token storage with `timingSafeEqual` constant-time comparison. Never log plaintext; never round-trip after one-time reveal.
2. Cookie hardening: `HttpOnly`, `Secure` in prod, `SameSite=Lax`, `Path=/`.
3. CSRF: `SameSite=Lax` + require `Content-Type: application/json` on JSON endpoints. No custom CSRF token in v1.
4. **404, not 403**, on cross-owner room access.
5. Server-side input validation with `zod`: slug regex, length caps (system prompt ≤ 50 KB), email format, JSON shape.
6. SQL parameterization throughout. Sort/filter columns from server-side whitelist (already convention).
7. Append-only audit log (no UPDATE/DELETE paths in `store.ts`).
8. Disable, don't delete, when removing creator access — preserves audit history and `owner_id` FK integrity.
9. Super-admin path independent from creator-token verification — `ADMIN_TOKEN` matched separately.
10. Rotating a creator token bumps `token_hash` immediately; old cookie stops on the next request.

## Migration Plan

In one PR on `claude/room-management-spec-j4Myh`:

1. Land migrations v6, v7, v8. Insert synthetic super-admin row with sentinel email.
2. Backfill `rooms.owner_id` to the synthetic row, then add `NOT NULL`.
3. Ship endpoints + pages. Existing `/admin/rooms` keeps working — synthetic super-admin owns every existing room.
4. Add the first real creator via `/admin/users`, paste their token, smoke-test creating + editing a room.
5. Optionally transfer existing rooms to real creators with `POST /api/admin/rooms/[id]/transfer`.

Rollback: forward-only migrations by convention; manual `psql` to drop the new columns/tables if it ever comes to that. Old code paths don't reference the new columns, so a partial rollback (just stop deploying the new code) is safe.

## Acceptance Checklist

Implementation is "done" when every item below is verified manually on the deployed VPS (or a local equivalent) with the migration applied:

1. **Migration is rerun-safe** — apply v6/v7/v8 twice; no errors; row counts stable.
2. **Existing rooms still load** — `/admin/rooms` lists every pre-existing room; opening any of them works exactly as before.
3. **Creator sign-in** — paste a fresh token at `/dashboard` → cookie set → page renders with empty room list. Wrong token → 401.
4. **Room create (creator path)** — submit slug + name + prompt → redirected to settings → room appears in `/dashboard`. Re-submitting the same slug → 409 with `ownerDisplayName` populated.
5. **Room create (legacy admin path)** — homepage create form still creates a room with auto-generated id. `x-admin-token` header still required.
6. **Ownership denial** — Creator A tries to `PATCH /api/room/<B's room>` → 404 (not 403). Creator A tries to open `/dashboard/rooms/<B's room>/settings` → 404.
7. **Archive flow** — owner archives → `/room/<id>` shows banner + composer hidden. Joins/messages/uploads all return 410. Brief and catchup endpoints still respond. Restore returns the room to active.
7a. **Archived-room write paths blocked** — verify each row of the soft-delete matrix individually: message edit (`PATCH /api/room/[id]/message/[msgId]`) returns 410, reaction (`POST /...message/[msgId]/react`) returns 410, file selection toggle (`POST /...files`) returns 410, file delete (`DELETE /...files/[fid]`) returns 410. File preview (`GET /...files/[fid]`) returns 200 for owner.
8. **Admin transfer** — super-admin transfers a room from Creator A to Creator B → `/dashboard` for B now lists the room; A no longer sees it; audit log has a `room.transfer` entry with `fromOwnerId` + `toOwnerId`.
9. **Disabled creator** — disable Creator A → A's cookie is rejected on next request → cookie cleared. A's rooms still appear in `/admin/rooms` and still respond to participants. Re-enable restores access.
10. **Token rotation** — rotate Creator A's token → old cookie returns 401 on next request → A pastes new token → access restored.
11. **Audit log surface** — every action in the metadata table above produces a row visible in `/dashboard/rooms/<id>/settings → Activity`. No actions are silently un-audited.
12. **Hard delete (super-admin)** — `DELETE /api/room/<id>` cascades to messages/files/participants. Audit row is written *before* the delete (with snapshot metadata).

## Deferred to v2 (reference only — see original spec for detail)

| Item | Why deferred |
|---|---|
| Per-creator + per-room OpenAI API keys + AES-GCM encryption | Provider-level OpenAI project budget on the global key is sufficient until creators actually want their own billing. Adds master-key boot dependency, encryption module, validation flow, last-4 display, key-source resolution. |
| Per-creator + per-room app-level spend caps | Provider-level is the hard guarantee. App-level adds value once usage tracking exists. |
| `usage_events` table + sparklines + $ tracking | Without per-creator keys, the only consumer is super-admin curiosity. Deferred until creators care about their own cost. When it lands: store tokens + price-multiplier id, compute $ at read time with a price table that has effective dates (avoids step-changes in historical charts when prices change). |
| Privacy elevation flow (in-room banner, creator revocation, audited reason) | Genuinely good design but unnecessary until creators store content sensitive enough that "super-admin sees everything by default" is a problem. v1 ships with super-admin retaining full visibility. |
| Email masking in admin views | Pairs with elevation flow. |
| `room_blocklist` table | Deferred until a real abuse case requires it. v1 kick = remove participant; they can rejoin if they have the link. |
| `created_by_id` cleanup | Drop in a follow-up after grepping for remaining readers. |
| `key_version` column on encrypted columns | Adds when AES-GCM lands in v2 — pre-allocate the column at that time so future rotation doesn't need a destructive re-encrypt migration. |

## Decisions (locked before implementation)

1. **Slug uniqueness** — first-come-first-served, globally unique. On collision: HTTP 409 with body `{ error: "slug_taken", ownerDisplayName }`. UI surfaces "that slug is taken by Priya Singh — try another."
2. **System prompt size cap** — **50 KB** (validated server-side with `zod`). Existing seeded prompts are well under 10 KB; this leaves room for richer facilitator scripts without enabling abuse.
3. **Disabled-creator behavior** — auth requests rejected with 401 + cookie cleared. The creator's existing rooms keep functioning under the same `owner_id`; super-admin retains full visibility. No key-resolution change because v1 has no per-creator keys (all `@ai` calls use the global `OPENAI_API_KEY`).
4. **`audit_log` retention** — append forever in v1. The expected write rate is small (rough estimate: <1K rows/month per active creator). Add a TTL cron only if the table crosses ~1M rows.
5. **Homepage create form** — unchanged. Continues to use the `x-admin-token` header path with auto-generated nanoid slug. The new creator-cookie path on `POST /api/room` is only reached from `/dashboard`. No deprecation in v1.
6. **Super-admin never authenticates as a creator** — the synthetic super-admin row has a sentinel `token_hash` that cannot match any sha256(token), so the `mindforum_creator_session` cookie path is **creator-only by construction**. Super-admin always authenticates via `ADMIN_TOKEN` (header for scripts, cookie for `/admin/rooms`). To create a room owned by a specific creator, super-admin uses the legacy header path (room is initially owned by `cr_super_admin`) followed by `POST /api/admin/rooms/[id]/transfer`. Two steps, but no auth-path duplication and no contradiction with the sentinel hash.

## Open Questions (none blocking implementation; ask if you disagree)

The above six decisions cover everything that came up during review. If any of them feels wrong, raise it before coding starts; otherwise treat them as locked.
