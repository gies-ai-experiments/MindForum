# Creator-Owned Rooms — Design

**Date:** 2026-05-07
**Branch:** `claude/room-management-spec-j4Myh`
**Status:** Design draft — pending review

## Problem

Today the only way to create a MindForum room is for the super-admin (Vishal) to either run the seed script from a terminal or use the existing `POST /api/room` with the global `ADMIN_TOKEN`. Faculty can't self-serve; every new room is a manual hand-off. We also can't attribute rooms to the people running them, can't bill OpenAI usage to the right faculty key, and have no way to delegate room management.

## Goal

A small set of allowlisted faculty ("creators") can sign in, create rooms, manage their own rooms (CRUD + participants + files), and attach their own OpenAI API key. The super-admin retains full visibility (every room, every creator, usage, audit) and is the only one who can manage the allowlist itself.

## Non-Goals

- Public sign-ups. The allowlist is curated by the super-admin only.
- Multi-tenant isolation beyond ownership scoping (no separate Postgres schemas, no per-tenant key rotation, etc.).
- Co-owners / shared rooms. Each room has exactly one owner.
- SSO, password auth, OAuth, MFA. Per-creator static tokens only (matches the existing `ADMIN_TOKEN` UX).
- Per-creator quotas or hard spend caps. Stats are observability-only in v1; cap enforcement is a follow-up if abuse appears.
- Editing or moderating *messages* from the dashboard. Creators can remove participants and edit room config; chat history is immutable except via the existing message-edit UI in-room.

## Personas

| Persona | Auth | Surfaces | Capabilities |
|---|---|---|---|
| **Super-admin** (you) | `ADMIN_TOKEN` cookie (existing) | `/admin/rooms`, `/admin/users`, `/admin/creators`, plus everything below | Manage the allowlist; see every creator and every room; see token usage / $ estimates; see audit log; impersonate-by-URL (visit any room directly via existing flow); hard-delete; rotate any creator's token. |
| **Creator** (allowlisted faculty) | Per-creator hashed token cookie | `/dashboard`, `/dashboard/rooms/<id>/settings` | Create rooms; CRUD their own rooms (name, system prompt, files, participants, archive/restore); set their own OpenAI key (account default + per-room override); see their own usage and audit log. |
| **Participant** (existing) | `mindforum_pid_<roomid>` cookie (existing) | `/room/<id>` | Unchanged. Cannot see the dashboard. Joining/posting in an archived room is blocked. |

## Decisions Snapshot

These were locked in during design Q&A and are referenced throughout the doc:

| Decision | Choice |
|---|---|
| Creator auth | Per-creator static token, hashed at rest, shown once on creation/rotation |
| Token lifetime | Long-lived; no expiry (mirrors `ADMIN_TOKEN`) |
| Permission model | Creator sees only their own rooms; super-admin sees everything |
| Creator CRUD | Edit name + system prompt; manage files; manage participants (remove + blocklist); soft-delete (archive) with restore |
| Allowlist storage | New `allowlisted_creators` table; super-admin UI at `/admin/users` |
| Routes | `/dashboard` for creators; `/admin/*` stays super-admin |
| Existing rooms | Backfilled to a synthetic admin creator row |
| Slug | Creator-picked, globally unique, validated `[a-z0-9-]{3,40}` |
| Archived rooms | `/room/<id>` returns 404; only owner + super-admin can restore; no auto-purge |
| Kick semantics | Remove participant + blocklist their email; messages preserved |
| API key | Per-creator default + per-room override; AES-256-GCM at rest |
| Spend caps | Defense-in-depth: provider-level (OpenAI project budget, hard) + app-level (monthly $ cap per creator, optional per-room override) |
| Privacy | Super-admin sees aggregates only by default; viewing a creator's room content requires explicit "elevate" with reason + audit-log entry visible to the creator. Creator is the data controller for room content. |
| Stats | Per-creator roll-up + drill-down, token + $ usage, sparklines, audit log |

## Architecture Overview

Three new route groups, three new tables, one new lib module for token + key crypto, and a small set of additions to `lib/store.ts`. No new external services. `nodemailer`/SMTP not required (token is pasted, not emailed — same as the admin token).

```
app/
  dashboard/                       NEW  creator surfaces
    page.tsx                            list-of-rooms + create form
    auth/route.ts                       POST token paste → set cookie
    rooms/[id]/settings/page.tsx        per-room CRUD UI
  admin/
    rooms/                         existing — extend with owner column, sparklines, $ usage
    users/                         NEW  allowlist CRUD
      page.tsx
      auth/route.ts
    creators/                      NEW  per-creator drill-down
      page.tsx
      [id]/page.tsx
  api/
    room/route.ts                  MODIFY  accept creator-token auth in addition to admin-token
    room/[id]/                     MODIFY  ownership-scoped guards on PATCH/DELETE/file/participant routes
    creator/                       NEW
      session/route.ts             POST: paste token → set cookie; DELETE: sign out
      me/route.ts                  GET current creator profile + key status
      api-key/route.ts             PUT/DELETE creator default key
      rooms/[id]/                  ownership-scoped variants of room ops (delegate to existing handlers)
    admin/
      seed/route.ts                existing
      users/route.ts               NEW  list/create allowlisted_creators
      users/[id]/route.ts          NEW  update/disable/rotate-token/delete
      stats/route.ts               NEW  super-admin aggregates
lib/
  admin-auth.ts                    existing
  creator-auth.ts                  NEW  hashing, cookie helpers, ownership guards
  crypto.ts                        NEW  AES-GCM encrypt/decrypt for OpenAI keys
  audit.ts                         NEW  append-only log helper
  store.ts                         add: creators table CRUD, ownership filters, usage queries, audit writes
  openai.ts                        MODIFY  resolve effective key (room override → creator default → global)
db/
  schema.sql                       new migrations v6–v9 (see Data Model)
middleware.ts                      gate /dashboard/* and /admin/* on the right cookie
```

## Data Model

Four new tables and a small column-level extension. All migrations are idempotent and bump `schema_migrations` per existing convention.

### v6 — `allowlisted_creators`

```sql
CREATE TABLE IF NOT EXISTS allowlisted_creators (
  id                      TEXT PRIMARY KEY,             -- short id, e.g. "cr_a1b2c3"
  email                   TEXT NOT NULL,
  display_name            TEXT NOT NULL,
  token_hash              TEXT NOT NULL,                -- sha256 hex of the plaintext token
  token_last_four         TEXT NOT NULL,                -- last 4 chars of plaintext, for UI display
  token_rotated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  openai_api_key_ct       BYTEA,                        -- AES-GCM ciphertext (NULL if unset)
  openai_api_key_iv       BYTEA,
  openai_api_key_tag      BYTEA,
  openai_api_key_last4    TEXT,
  openai_api_key_set_at   TIMESTAMPTZ,
  monthly_cap_usd         NUMERIC(10,2),                -- NULL = no app-level cap; warn+block at this threshold
  monthly_warn_pct        SMALLINT NOT NULL DEFAULT 80, -- email/UI warn threshold (0–100); ignored if cap NULL
  is_super_admin          BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE only for the synthetic admin row
  disabled_at             TIMESTAMPTZ,                  -- soft-disable; cannot auth while set
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              TEXT                          -- id of the super-admin who added them
);

CREATE UNIQUE INDEX IF NOT EXISTS allowlisted_creators_email_uniq
  ON allowlisted_creators (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS allowlisted_creators_token_hash_uniq
  ON allowlisted_creators (token_hash);
```

A single synthetic super-admin row is inserted at migration time so existing rooms can be backfilled with a real foreign-key target. The super-admin still authenticates via `ADMIN_TOKEN` (the cookie path is unchanged); the `is_super_admin` flag exists so dashboards / queries can join cleanly.

### v7 — `rooms` extensions

```sql
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS owner_id              TEXT REFERENCES allowlisted_creators(id) ON DELETE RESTRICT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS archived_at           TIMESTAMPTZ;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS openai_api_key_ct     BYTEA;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS openai_api_key_iv     BYTEA;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS openai_api_key_tag    BYTEA;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS openai_api_key_last4  TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS monthly_cap_usd       NUMERIC(10,2);  -- NULL = inherit creator cap

-- Backfill: every existing room → synthetic super-admin row.
UPDATE rooms SET owner_id = (SELECT id FROM allowlisted_creators WHERE is_super_admin) WHERE owner_id IS NULL;

ALTER TABLE rooms ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS rooms_owner_idx ON rooms (owner_id);
CREATE INDEX IF NOT EXISTS rooms_archived_idx ON rooms (archived_at) WHERE archived_at IS NULL;  -- partial: speeds "active rooms" filter
```

`ON DELETE RESTRICT` on `owner_id` is intentional: deleting a creator with rooms must explicitly transfer or archive those rooms first. Keeps us out of cascade-surprise territory.

The legacy `created_by_id` column stays (it points to a participant row and is still used elsewhere in the code); `owner_id` is the new authoritative ownership column.

### v8 — `room_blocklist`

```sql
CREATE TABLE IF NOT EXISTS room_blocklist (
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  email_lower  TEXT NOT NULL,                          -- always lower(email)
  blocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_by   TEXT NOT NULL,                          -- creator id who issued the block
  PRIMARY KEY (room_id, email_lower)
);
```

Checked by `POST /api/room/[id]/join` before `upsertParticipant`. Removing a participant atomically deletes their `participants` row and inserts a `room_blocklist` row in one transaction.

### v9 — `audit_log` and `usage_events`

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id    TEXT NOT NULL,                           -- allowlisted_creators.id, or 'super_admin'
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,                           -- e.g. 'room.create', 'room.archive', 'participant.kick'
  room_id     TEXT,                                    -- nullable; NULL for non-room actions like allowlist changes
  target      TEXT,                                    -- e.g. kicked email, file id, etc.
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_room_idx  ON audit_log (room_id, at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL REFERENCES allowlisted_creators(id),
  model         TEXT NOT NULL,                         -- e.g. 'gpt-5.4'
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd  NUMERIC(10,6) NOT NULL,                -- computed at log time from a model→price table in lib/openai.ts
  key_source    TEXT NOT NULL                          -- 'room' | 'creator' | 'global'
);

CREATE INDEX IF NOT EXISTS usage_events_owner_at_idx ON usage_events (owner_id, at DESC);
CREATE INDEX IF NOT EXISTS usage_events_room_at_idx  ON usage_events (room_id, at DESC);
```

Both tables are append-only by convention (no `UPDATE`/`DELETE` paths in `store.ts`). `audit_log.metadata` carries free-form context (e.g. before/after diffs of the system prompt) without schema churn. `usage_events.est_cost_usd` denormalizes the price multiplier so historical totals don't drift when prices change; the multiplier table lives in `lib/openai.ts` and is the single source of truth at write time.

## Auth Model

### Creator token

- Generated as 32 bytes from `crypto.randomBytes`, base64url-encoded → ~43 chars.
- The plaintext token is shown to the super-admin **once** in the `/admin/users` UI at creation/rotation, with a "copy" button and a confirmation that it cannot be retrieved later.
- The DB stores only `sha256(plaintext)` plus the last four chars (for UI display: "ends in `…aB7c`").
- Verification on every request: `crypto.timingSafeEqual(sha256(cookie_value), token_hash)`. Always with constant-time comparison.

### Cookie

```
mindforum_creator_session   HttpOnly, Secure (in prod), SameSite=Lax, Path=/, Max-Age=1y
```

Value = the plaintext token. The server hashes on every request to look up the row. We do not store a separate session id because there's no session state to attach (no "logged in at", no device tracking) — the cookie is the credential.

Sign-in flow:

1. Super-admin shares the token with the creator (out of band).
2. Creator visits `/dashboard`. If the cookie is missing or unrecognized, they get a token-paste form (mirrors `/admin/rooms` UX).
3. Form POSTs to `/api/creator/session`, which validates and sets the cookie.
4. Subsequent requests send the cookie; middleware + route handlers read it and resolve the creator row.

Sign-out: `DELETE /api/creator/session` clears the cookie. Useful if a creator is on a shared machine.

Disabled creators: if `disabled_at IS NOT NULL`, every authenticated request is rejected with 401 and the cookie is cleared. The super-admin disables rather than deletes when removing access — preserves audit log integrity and lets the creator's rooms keep functioning under the same `owner_id`.

### Ownership guard

A small helper is the single chokepoint for "is this creator allowed to touch this room?":

```ts
// lib/creator-auth.ts
export async function requireRoomOwner(req: Request, roomId: string): Promise<{ creator: Creator; room: Room }> {
  const creator = await requireCreator(req);                  // 401 if no/invalid cookie or disabled
  const room = await getRoom(roomId);                         // 404 if missing
  if (!creator.isSuperAdmin && room.ownerId !== creator.id) {
    throw new HttpError(404, "not_found");                    // 404 not 403 — don't leak existence
  }
  return { creator, room };
}
```

Every creator-facing room mutation calls this before doing anything else. Returning 404 (not 403) on cross-owner access avoids leaking room ids — same pattern GitHub uses for private repos.

### Super-admin

Unchanged. The existing `ADMIN_TOKEN` cookie is still the super-admin credential. Internally we treat super-admin as "creator with `is_super_admin = TRUE`, no ownership constraint." The synthetic super-admin row exists so foreign keys and audit-log entries have a real `actor_id` to reference; it is **not** authenticated via its `token_hash` (the row's hash field stores a sentinel value that never matches anything because `ADMIN_TOKEN` is matched separately). This keeps the admin path independent of the creator token system, so a bug in creator-token verification cannot escalate to super-admin.

## API Surface

### Creator session

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `POST` | `/api/creator/session` | Body `{ token }` | Validate token; set `mindforum_creator_session` cookie; return `{ id, email, displayName }`. |
| `DELETE` | `/api/creator/session` | Cookie | Clear the cookie. 204. |
| `GET` | `/api/creator/me` | Cookie | Return profile + `{ hasApiKey: boolean, apiKeyLast4: string \| null }`. |
| `PUT` | `/api/creator/api-key` | Cookie + body `{ key }` | Validate key against OpenAI `/v1/models`; encrypt; store; return `{ last4 }`. |
| `DELETE` | `/api/creator/api-key` | Cookie | Null out the encrypted columns. |
| `PUT` | `/api/creator/cap` | Cookie + body `{ monthlyCapUsd, warnPct }` | Set/clear creator's monthly cap. |

### Rooms (creator-scoped)

The existing `app/api/room/route.ts` (`POST`) and `app/api/room/[id]/...` handlers are extended in place rather than duplicated. Each handler accepts **either** the admin cookie **or** the creator cookie; the difference is what the ownership guard returns.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `POST` | `/api/room` | Admin cookie OR creator cookie | Body `{ id, name, systemPrompt }`. Slug validated `[a-z0-9-]{3,40}`. Creator becomes `owner_id`; super-admin chooses owner via `ownerId` body field (defaults to self / synthetic super-admin row). |
| `PATCH` | `/api/room/[id]` | `requireRoomOwner` | Update name and/or systemPrompt. Logs `room.update` with before/after diff. |
| `POST` | `/api/room/[id]/archive` | `requireRoomOwner` | Set `archived_at = NOW()`. Idempotent. Logs `room.archive`. |
| `POST` | `/api/room/[id]/restore` | `requireRoomOwner` | Set `archived_at = NULL`. Idempotent. Logs `room.restore`. |
| `DELETE` | `/api/room/[id]` | Super-admin only | Hard delete. Cascades via existing FKs. Logs `room.hard_delete`. |
| `PUT` | `/api/room/[id]/api-key` | `requireRoomOwner` + body `{ key \| null }` | Set or clear the per-room override. Validates against OpenAI like the creator key. |
| `PUT` | `/api/room/[id]/cap` | `requireRoomOwner` + body `{ monthlyCapUsd \| null }` | Set/clear per-room cap (null = inherit creator cap). |
| `DELETE` | `/api/room/[id]/participants/[pid]` | `requireRoomOwner` | Remove participant + blocklist email in one transaction. Logs `participant.kick`. |
| `DELETE` | `/api/room/[id]/blocklist/[email]` | `requireRoomOwner` | Unblock. Logs `participant.unblock`. |
| `POST` | `/api/room/[id]/files` | `requireRoomOwner` (creator) OR existing participant cookie (in-room upload) | Existing flow, now also reachable from settings UI. |
| `DELETE` | `/api/room/[id]/files/[fid]` | `requireRoomOwner` | Delete file. Logs `file.delete`. |
| `PATCH` | `/api/room/[id]/files/[fid]` | `requireRoomOwner` + body `{ selected }` | Toggle inclusion. |

### Admin / allowlist

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/api/admin/users` | Admin cookie | List all allowlisted_creators with stats (room count, last activity, key set?). |
| `POST` | `/api/admin/users` | Admin cookie | Body `{ email, displayName }`. Generate token, return plaintext **once**. |
| `PATCH` | `/api/admin/users/[id]` | Admin cookie | Update displayName, disable/enable. |
| `POST` | `/api/admin/users/[id]/rotate-token` | Admin cookie | Generate a new token, return plaintext once, invalidate the old one. |
| `DELETE` | `/api/admin/users/[id]` | Admin cookie | Hard-delete. Refused if creator owns any rooms (UX prompts to disable or transfer instead). |
| `POST` | `/api/admin/rooms/[id]/transfer` | Admin cookie + body `{ ownerId }` | Reassign room ownership. Logs `room.transfer`. |
| `POST` | `/api/admin/rooms/[id]/elevate` | Admin cookie + body `{ reason }` | Grant a 60-min content-view elevation. Logs `room.elevate`. Surfaces in-room banner. |
| `DELETE` | `/api/admin/rooms/[id]/elevate` | Admin cookie | Revoke own elevation early. |
| `PUT` | `/api/admin/users/[id]/cap` | Admin cookie + body `{ monthlyCapUsd, warnPct }` | Override a creator's cap (audited). |
| `GET` | `/api/admin/stats` | Admin cookie | Return per-creator + per-room aggregates for the dashboard (see Statistics). All metadata; no message content. |

### Public room reads

`/api/room/[id]/...` *read* endpoints (snapshot, SSE, message GET) get one new check: if `archived_at IS NOT NULL`, return 410 Gone for non-owners, 200 for the owner / super-admin (so they can still review history before restoring or transferring). Joins (`POST .../join`) and writes (post message, upload, react) are blocked outright with 410.

## OpenAI Key Resolution

`lib/openai.ts` exposes a single `resolveOpenAIKey(roomId)` that returns `{ key, source }`:

```
1. SELECT openai_api_key_ct, iv, tag FROM rooms WHERE id = $1
   → if present, decrypt and return { key, source: 'room' }
2. SELECT openai_api_key_ct, iv, tag FROM allowlisted_creators
   WHERE id = (SELECT owner_id FROM rooms WHERE id = $1)
   → if present, decrypt and return { key, source: 'creator' }
3. Return { key: process.env.OPENAI_API_KEY, source: 'global' }
```

`source` is recorded on every `usage_events` row, so we can answer "are any creators leaning on the global key?" at a glance from the admin dashboard.

### Encryption

`lib/crypto.ts` wraps Node's built-in `createCipheriv('aes-256-gcm', ...)`:

- Master key from `KEY_ENCRYPTION_KEY` env var: 32 bytes, base64-encoded. Required at boot; server refuses to start without it. Generated once with `openssl rand -base64 32`, stored in `.env.local` only, never committed.
- Each encryption uses a fresh 12-byte random IV (`crypto.randomBytes(12)`).
- `tag` is the 16-byte GCM auth tag — without it, decryption fails closed (we don't fall through to a plaintext path).
- Key rotation: a follow-up. v1 supports a single master key. When we need to rotate, we'll add a `key_version` column and a re-encrypt migration; out of scope here.

### Validation on save

When a creator/admin sets a key, the server makes a `GET https://api.openai.com/v1/models` request with the new key and a 5-second timeout. Reject on non-200. This catches typos and revoked keys before a faculty member finds out via a broken room. Keys never appear in server logs (we mask them in any error path).

### Last-4 display

UI shows `sk-…aB7c` (first 3 chars of the prefix + last 4) and a "Replace key" button. We never round-trip the plaintext to the browser.

## Spend Caps

Two layers, defense in depth. Provider-level is the hard guarantee; app-level gives smooth UX, lets us cap below the provider limit, and works even if the provider's enforcement lags.

### Provider-level (recommended primary control)

OpenAI exposes monthly spend limits at the project / organization level. The recommended posture is **one project per creator** at OpenAI:

1. Creator (or you, on their behalf) creates an OpenAI **project** dedicated to their MindForum rooms.
2. In `platform.openai.com → Settings → Limits → Usage limits`, set:
   - **Soft limit (notification)**: e.g. 80% of the monthly budget — emails the project owner.
   - **Hard limit (block)**: e.g. 100% — OpenAI starts returning HTTP 429/insufficient-quota.
3. The creator generates a project-scoped API key from that project. They paste *that* key into MindForum.

This is the only control that *guarantees* OpenAI stops billing past the cap; everything app-level is best-effort. Document this in the creator onboarding flow as a required step, not a recommendation. The MindForum side surfaces this state by detecting the `insufficient_quota` error code on AI calls and displaying a clear "this room hit its OpenAI budget" banner instead of a generic failure.

For admin-owned rooms still using the global `OPENAI_API_KEY`, set the same limits on the dedicated MindForum project. (This is already in the open Roadmap items in `CLAUDE.md`; the work converges here.)

### App-level (in-process)

Per-creator monthly cap, with optional per-room override. Both nullable; null means "no app-level cap, defer to provider."

```ts
// lib/openai.ts — checked before every AI call
async function checkSpendCap({ ownerId, roomId }): Promise<void> {
  const room = await getRoom(roomId);
  const owner = await getCreator(ownerId);
  const cap = room.monthlyCapUsd ?? owner.monthlyCapUsd;
  if (cap == null) return;                                       // no cap configured

  const spend = await sumMonthlyUsage({ ownerId, roomId: room.monthlyCapUsd ? roomId : undefined });
  if (spend >= cap) {
    throw new HttpError(429, "monthly_cap_reached", { spend, cap });
  }
}
```

Notes:

- **Calendar-month rolling**: `WHERE at >= date_trunc('month', NOW())`. Resets at UTC month boundary, matching OpenAI billing.
- **Pre-call check, not per-token**: we don't pre-estimate the cost of the upcoming call — we just refuse to start if the existing month-to-date sum is already at/over the cap. This means a single in-flight call can push spend slightly past the cap (typical bound: a few cents). Acceptable; provider-level catches the catastrophic case.
- **Warn threshold**: `monthly_warn_pct` (default 80) — the dashboard surfaces a yellow banner once month-to-date crosses that fraction of the cap, and a red banner at 100% with a "your room is paused" message and a link to bump the cap.
- **UI**: creator dashboard shows `$3.42 / $10.00 used this month (34%)`; admin can see and edit caps from `/admin/creators/[id]`.
- **Cap edits are immediate**: no rate-limiting, no cool-down. Audited.
- **Per-room override**: when set, the room's spend is checked against the room's cap (and only the room's spend). When null, the room's spend rolls up into the creator-level cap along with the creator's other rooms.

### Failure mode

If a call is rejected at either layer, the AI message bubble in the room shows: "AI replies are paused — this room (or its creator) has reached the monthly OpenAI budget. Contact the room owner." No retry storm; human action required.

## Privacy Model

The privacy boundary is: **the creator is the data controller** for the content of their rooms (messages, files, participants). The super-admin runs the platform but does not consume that content as a matter of routine. This matches the realistic ethics of the use case (faculty running confidential brainstorms) and the right boundary if MindForum ever needs to make compliance representations.

### What super-admin sees by default

| Surface | Sees | Does not see |
|---|---|---|
| `/admin/rooms` | Room name, slug, owner display name, owner email, archived status, key source, last activity timestamp, message count, participant count, file count, est. 30d $ | Message content, file content, individual participant emails, AI system prompt |
| `/admin/creators` and `/admin/creators/[id]` | Per-creator aggregates, list of rooms (metadata only), audit log of *creator* actions, monthly spend | Per-message content, file content, system prompt, participant emails inside rooms |
| `/admin/users` | Allowlist CRUD, last-4 of token, last-4 of API key | Plaintext token, plaintext API key |
| Audit-log view | Action types, timestamps, actor, room id, *hashes* of before/after for system-prompt edits | Full system-prompt text, full message content |

`/admin/rooms` keeps a "Open in app" link for **admin-owned rooms only**. For creator-owned rooms, that action is replaced by a **"Request access"** flow (see below). The room URL itself remains guessable from the slug, but visiting `/room/<slug>` as super-admin returns a 403 with a link to the elevation flow rather than rendering the room. This is the load-bearing piece of the privacy model: the super-admin cannot accidentally page through messages while doing routine ops.

### Elevation flow ("super-admin needs to view a creator's room")

Reasons this is needed: abuse report, suspected misuse, debug a user-reported bug. The flow:

1. Super-admin clicks **"Request access"** on a creator-owned room in `/admin/rooms`. Modal asks for a free-text reason (required, ≥10 chars).
2. Server inserts an `audit_log` row: `action='room.elevate'`, `actor='super_admin'`, `room_id=...`, `metadata={ reason, expires_at }`. Sets a 60-minute scoped capability (`elevations` table; see schema below).
3. While the elevation is active, super-admin can load `/room/<slug>` and see content. The room renders with a persistent banner — visible to *everyone in the room*, including participants — that reads: **"Site administrator <name> is reviewing this room (until HH:MM). Reason: <reason>."**
4. The creator gets a copy of the audit-log entry on their `/dashboard/rooms/<id>/settings → Activity` tab the next time they load it (no email; in-app only).
5. Elevation expires automatically after 60 minutes; super-admin can extend explicitly with a new reason (logged separately).

```sql
-- v9 addendum (lands in same migration as audit_log/usage_events)
CREATE TABLE IF NOT EXISTS elevations (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    TEXT NOT NULL,                            -- 'super_admin'
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS elevations_active_idx ON elevations (room_id, expires_at) WHERE revoked_at IS NULL;
```

The room's gate becomes: `super_admin AND elevation_active(room_id) → render` else 403. Creator can revoke an active elevation from their settings (sets `revoked_at`); super-admin sees a "revoked by owner" message and the elevation immediately stops working.

### Participant-PII handling

Participants give MindForum their email + display name on join. That's structurally needed (mention completion, identity in chat). Privacy posture:

- **Creator** sees their participants' emails — they are the data controller and need this for moderation.
- **Super-admin** sees emails *only* of participants in admin-owned rooms; for creator-owned rooms, the participants tab in `/admin/rooms` drill-down shows display name + last-seen but masks the email (`a***@example.com`). Full email visible only during an active elevation.
- **Audit-log entries** that mention a participant email (e.g. `participant.kick`) get the same treatment: super-admin views see masked email; creator views see full email.
- Files attribute to a participant via display name; the email mask rule applies in admin views.

### What to put in the room UI for participants

A new line in the room footer / header info: **"This room is operated by <creator name> (<creator email>). Messages and files you share are visible to other participants and the room operator. Site admins do not see room content unless they request access; you'll be notified in-room if they do."** Links to a one-page `/privacy` doc.

### Logs and crash dumps

- Server logs **never** include message content, file content, or API keys. We already mask keys; tighten the message-streaming code to use ids/lengths only in any new log call sites added by this work.
- `usage_events.metadata` would be tempting to include prompt previews — don't. Token counts only.

### Data export & deletion

- **Creator export**: a "Download room data" button on the settings page produces a JSON of messages + files + participants for that room. Same data the creator already sees in-room; just a file. (Useful for compliance handoff or end-of-semester archive.)
- **Creator delete**: hard-delete via super-admin only (creators only soft-delete). On hard-delete, cascades wipe all messages, files, participants, blocklist, audit_log entries scoped to that room.
- **Right-to-erasure for participants**: today no flow; for now, "ask the room creator to remove your participant row + delete your messages." A v2 self-serve flow for participants is out of scope.

### Privacy: best-practices checklist

1. **Data minimization in admin views** — aggregates only by default; full content requires elevation.
2. **Email masking** — `a***@example.com` rendering helper used everywhere a non-data-controller views a participant.
3. **Visible elevations** — elevation banner in-room makes admin access non-secret; required for ethics.
4. **Append-only audit log** of every elevation, with reason — admin can't quietly erase the trail.
5. **Creator-controlled revocation** — owner can kill an active elevation immediately.
6. **No content in logs** — message and file content never leaves the DB into stdout/files.
7. **No content in `metadata`** — system-prompt diffs are stored as length + sha256, not full text.
8. **Encrypted at rest** for credentials (tokens via hash, OpenAI keys via AES-GCM). DB content (messages, files, prompts) remains plaintext in v1; full DB-level encryption is a follow-up if compliance ever demands it (Postgres TDE / column encryption).
9. **Delete-on-deletion** — deleting a room cascades to all derived tables (already enforced by FK `ON DELETE CASCADE`).
10. **In-room privacy notice** — participants see who controls their data and the elevation policy.

## UI

### `/dashboard` (creator)

Server component. If no creator cookie → token-paste form. If cookie → page with two sections:

1. **Your rooms** — table similar to `/admin/rooms` but filtered to `owner_id = me`. Columns: name, status (active / archived), last activity, 7d messages, participants, files, est. $ this month. Row actions: open room, open settings, archive/restore, copy share link.
2. **Create room** — small form: slug (with live validation + uniqueness ping), display name, system prompt textarea. Submit → `POST /api/room`. On success, redirect to `/dashboard/rooms/<id>/settings`.

A header strip shows `email · ends in …aB7c · Sign out` plus an API-key status badge ("Default key set / not set"). Clicking the badge opens an inline modal with the PUT/DELETE flow.

### `/dashboard/rooms/[id]/settings` (creator)

Tabbed page (single client component). Auth on the server via `requireRoomOwner`.

- **General** — name, system prompt, archive/restore button (with confirm), per-room OpenAI key override (with "use account default" toggle).
- **Files** — list with name, size, uploader, "selected for context" toggle, delete. Upload widget reuses the existing `/api/room/[id]/files` endpoint.
- **Participants** — list with name, email, joined-at, last-seen, message count. Action: remove (confirm modal: "remove and block @example.com from rejoining? Their messages will remain.").
- **Blocklist** — read-only list of blocked emails with an unblock action.
- **Activity** — last 50 audit-log entries scoped to this room.

### `/admin/rooms` (extended)

Existing table gets new columns: **Owner** (display name → links to `/admin/creators/<id>`), **Archived?**, **Key source** (room/creator/global, color-coded), **Est. $ 30d**, **Cap status** (e.g. "$3.42 / $10.00", warning/red colors). Existing query is extended with two `LEFT JOIN`s plus a 30-day aggregation over `usage_events`. Sort whitelist gets the new columns. Filter `?archived=true|false|all` (default `false`).

The "open room" link behaves differently per ownership:
- **Admin-owned rooms** — link goes straight to `/room/<slug>`, as today.
- **Creator-owned rooms** — link is replaced by a **"Request access"** button that opens the elevation modal. Once an elevation is active, the button changes to "Open room (elevation expires HH:MM)" and a "Revoke" link.

Sort options that depend on message content (none currently exist) would not be added here.

### `/admin/users` (new)

CRUD for the allowlist. Table of creators with display name, email, room count, last activity, status (active / disabled), token last-4. Row actions:

- **Create** — modal asking email + display name. On submit, server returns the plaintext token; UI shows a one-time reveal panel with copy button + warning ("This is the only time you'll see it. The creator should paste it at `/dashboard`."). Closing the panel destroys the value in browser memory.
- **Rotate token** — same one-time reveal flow. Old token stops working immediately.
- **Disable / Enable** — toggle `disabled_at`.
- **Delete** — only available when room count is zero; otherwise the button is disabled with a tooltip pointing to "transfer rooms first."

### `/admin/creators/[id]` (new)

Per-creator drill-down: profile, rooms owned (active + archived sections), 30-day usage chart (sparkline + token totals + $ estimate), audit-log feed scoped to this creator. "Transfer rooms…" action that opens a modal listing the creator's rooms with a per-row "transfer to →" dropdown of other allowlisted creators.

## Soft-Delete & Visibility Semantics

| Endpoint | Active | Archived (non-owner) | Archived (owner) | Archived (super-admin) |
|---|---|---|---|---|
| `GET /room/[id]` (page) | render | 404 | render with banner "Archived — restore to reopen" | 403 unless elevation active; with elevation, render read-only |
| `GET /api/room/[id]/snapshot` | 200 | 410 | 200 (read-only flag) | 403 / 200 with elevation |
| `GET /api/room/[id]/stream` (SSE) | streams | 410 | streams (read-only) | 403 / streams with elevation |
| `POST /api/room/[id]/join` | 200 | 410 | 410 | 410 |
| `POST /api/room/[id]/message` | 200 | 410 | 410 | 410 |
| `POST /api/room/[id]/files` | 200 | 410 | 410 (settings UI surfaces this clearly) | 410 |

Cookies for participants in a since-archived room are not invalidated; they're just gated by the active-room check. If the room is later restored, those participants reconnect and pick up their existing identity.

## Statistics

The super-admin dashboards lean on three queries, all hitting the new indexes.

### Per-creator roll-up (`/admin/users`, `/admin/creators`)

```sql
SELECT
  c.id, c.email, c.display_name, c.disabled_at,
  COUNT(r.id)                               FILTER (WHERE r.archived_at IS NULL) AS active_rooms,
  COUNT(r.id)                               FILTER (WHERE r.archived_at IS NOT NULL) AS archived_rooms,
  MAX(activity.last_message_at)             AS last_activity_at,
  COALESCE(SUM(usage30.tokens_in), 0)       AS tokens_in_30d,
  COALESCE(SUM(usage30.tokens_out), 0)      AS tokens_out_30d,
  COALESCE(SUM(usage30.est_cost_usd), 0)    AS est_cost_30d
FROM allowlisted_creators c
LEFT JOIN rooms r ON r.owner_id = c.id
LEFT JOIN LATERAL (
  SELECT MAX(m.created_at) AS last_message_at FROM messages m WHERE m.room_id = r.id
) activity ON TRUE
LEFT JOIN LATERAL (
  SELECT
    SUM(input_tokens)  AS tokens_in,
    SUM(output_tokens) AS tokens_out,
    SUM(est_cost_usd)  AS est_cost_usd
  FROM usage_events u
  WHERE u.owner_id = c.id AND u.at > NOW() - INTERVAL '30 days'
) usage30 ON TRUE
WHERE c.is_super_admin = FALSE
GROUP BY c.id, usage30.tokens_in, usage30.tokens_out, usage30.est_cost_usd
ORDER BY last_activity_at DESC NULLS LAST;
```

### Per-room sparkline (`/admin/rooms` row, `/admin/creators/[id]`)

```sql
SELECT date_trunc('day', m.created_at) AS day, COUNT(*) AS msgs
FROM messages m
WHERE m.room_id = $1 AND m.created_at > NOW() - INTERVAL '30 days'
GROUP BY day ORDER BY day;
```

Rendered as a 30-bucket inline SVG; no chart library.

### $ usage breakdown (`/admin/creators/[id]`)

```sql
SELECT date_trunc('day', at) AS day,
       SUM(est_cost_usd) AS cost,
       SUM(input_tokens) AS tokens_in,
       SUM(output_tokens) AS tokens_out,
       key_source
FROM usage_events
WHERE owner_id = $1 AND at > NOW() - INTERVAL '30 days'
GROUP BY day, key_source ORDER BY day;
```

`key_source` faceting answers "is this creator on their own key or leaning on yours?" at a glance.

## Audit Log

Every state-changing action funnels through `lib/audit.ts`:

```ts
await audit.log({
  actor: creator,           // or { id: 'super_admin', email: process.env.ADMIN_EMAIL ?? 'super_admin' }
  action: 'room.archive',
  roomId,
  metadata: { previousArchivedAt: room.archived_at },
});
```

Actions covered in v1:

- `allowlist.create`, `allowlist.update`, `allowlist.disable`, `allowlist.enable`, `allowlist.delete`, `allowlist.rotate_token`
- `room.create`, `room.update`, `room.archive`, `room.restore`, `room.hard_delete`, `room.transfer`
- `room.api_key.set`, `room.api_key.clear`, `creator.api_key.set`, `creator.api_key.clear`
- `room.cap.set`, `room.cap.clear`, `creator.cap.set`, `creator.cap.clear`
- `room.elevate`, `room.elevate.extend`, `room.elevate.revoke`, `room.elevate.expire`
- `participant.kick`, `participant.unblock`
- `file.delete`, `file.toggle_selected`

`metadata` carries diffs for `update` actions (e.g. `{ name: { from, to }, systemPrompt: { fromHash, toHash, fromLen, toLen } }` — we hash the system prompt rather than store both copies, since prompts can be large).

The log is read-only from the UI: super-admin sees a global feed at `/admin/creators` (sidebar), creators see a per-room feed in the **Activity** tab.

## Rate Limits

Existing `POST /api/room` is 5/10min per IP — keep it. Layer per-creator caps on top so a single misbehaving creator can't drown out others sharing an IP (e.g. campus VPN):

| Endpoint | Per-IP | Per-creator-id |
|---|---|---|
| `POST /api/room` | 5 / 10 min | 20 / day |
| `PATCH /api/room/[id]` | n/a | 60 / hour |
| `POST /api/room/[id]/archive` | n/a | 30 / day |
| `DELETE /api/room/[id]/participants/[pid]` | n/a | 30 / day |
| `POST /api/creator/session` | 10 / min | n/a (no creator yet) |
| `PUT /api/creator/api-key` | n/a | 10 / hour |

In-memory like the existing limiter; resets on process restart. Same trade-off as today.

## Security Best-Practices Checklist

1. **Hashed token storage** with constant-time comparison (`timingSafeEqual`). Never log plaintext tokens; never return them after the one-time reveal.
2. **AES-256-GCM** for OpenAI keys with per-record IV and auth tag; fail-closed on decrypt errors. Master key from env, never in DB.
3. **Validate API keys on save** by hitting OpenAI `/v1/models` so faculty don't paste typos that surface as in-room failures.
4. **Mask all secrets in UI**: tokens by last 4, OpenAI keys by `sk-…last4`. Never round-trip plaintext to browser after the initial reveal.
5. **Cookie hardening**: `HttpOnly`, `Secure` in prod, `SameSite=Lax`, `Path=/`. No JS access path to the token.
6. **CSRF**: state-changing endpoints accept the cookie + a JSON body. Cross-origin POSTs from an attacker site can't reach JSON endpoints with `SameSite=Lax`. We additionally require `Content-Type: application/json` for JSON routes (rejects standard form-CSRF). No custom CSRF token in v1; flag as a v2 candidate if we ever add browser-form-style submissions.
7. **404, not 403**, on cross-owner access — don't leak room ids.
8. **Server-side input validation** with `zod` schemas at every API boundary: slug regex, length caps (system prompt ≤ 50 KB to avoid OOM in the prompt-construction path), email format, JSON shape.
9. **SQL parameterization** is already the convention; new code uses the same `$1, $2` style. Sort/filter columns are looked up from a server-side whitelist (already done in `/admin/rooms`).
10. **Append-only audit log**; no `UPDATE`/`DELETE` paths. Log actor email *and* id (id can be deleted; email is the human anchor).
11. **Disable, don't delete**, when removing creator access — preserves audit history and keeps `owner_id` foreign keys intact.
12. **Super-admin path is independent** from creator-token verification: a bug in the creator path cannot escalate to super-admin because `ADMIN_TOKEN` is matched separately.
13. **Block re-uploads of compromised tokens**: rotating a creator token bumps `token_hash` immediately; the old cookie stops working on the next request, no grace period.
14. **Migration ordering**: schema changes (v6–v9) run before any code that references them. Existing `npm run migrate` already runs in numeric order.
15. **Backfill is idempotent**: `UPDATE rooms SET owner_id = (...) WHERE owner_id IS NULL` is safe to re-run if migration is interrupted.
16. **Operational**: add `KEY_ENCRYPTION_KEY` to `Required env vars` in `CLAUDE.md` and the deploy recipe; add a startup check that refuses to boot if the var is missing or not 32 bytes when base64-decoded.

## Migration Plan

In one PR, on `claude/room-management-spec-j4Myh`:

1. Add `KEY_ENCRYPTION_KEY` to `.env.local` on VPS (`openssl rand -base64 32`). Land migrations v6–v9. Insert the synthetic super-admin row keyed by `process.env.ADMIN_EMAIL` (new optional env var; defaults to `admin@mindforum.local`).
2. Backfill `rooms.owner_id` to the synthetic row, then add the `NOT NULL` constraint.
3. Ship the new endpoints and pages. Existing `/admin/rooms` keeps working because the synthetic super-admin owns every existing room.
4. Add the first real creator via `/admin/users`, paste their token, smoke-test creating a room.
5. Create one or two real allowlisted creators. Optionally transfer specific existing rooms to them with `POST /api/admin/rooms/[id]/transfer`.

Rollback: drop the new columns/tables with a v10 down-migration if needed; existing room behavior continues to work because old code paths don't reference the new columns. (We don't ship a down-migration in this PR — manual `psql` if it ever comes to that, since migrations are forward-only by convention.)

## Out of Scope / Follow-ups

- Per-token streaming cap enforcement (v1 is pre-call only; in-flight call can overshoot by cents).
- Self-serve participant data export / right-to-erasure (today: ask the creator).
- Full at-rest encryption of message and file content (v1 leaves Postgres content plaintext; encryption keys for credentials only).
- Co-owners / shared rooms.
- Self-service creator invitations (super-admin still hands out tokens out-of-band).
- SSO or OAuth.
- Key-version rotation for `KEY_ENCRYPTION_KEY` (single-key v1).
- CSRF tokens beyond `SameSite=Lax` + JSON content-type enforcement.
- Per-creator email notifications (mention pings already exist; "your room got a new message" digest is a separate feature).
- Bulk room transfer or bulk archive UX.

## Open Questions

1. **Synthetic super-admin email** — what value should we put in `allowlisted_creators.email` for the admin row? Suggest the operator's real email (yours), gated behind a new `ADMIN_EMAIL` env var. Confirm before migrating.
2. **System prompt size cap** — proposing 50 KB. Existing seeded prompts are well under 10 KB. Confirm or lower.
3. **API-key validation cost** — `GET /v1/models` is free but counts as a request against the key's account; acceptable trade-off vs. shipping a typo'd key into a room. Confirm.
4. **Transfer ownership flow** — should `POST /api/admin/rooms/[id]/transfer` also notify the new owner (in-room system message), or stay silent? Default: silent; super-admin tells the creator out of band.
5. **Default monthly cap** — should newly-created creators get a default app-level cap (e.g. $20/month) or no cap until you set one? Default proposal: no cap on creation; you set per-creator on the `/admin/users` row. Provider-level limit on their OpenAI project remains the hard backstop regardless.
6. **Elevation duration** — proposing 60 minutes. Long enough to investigate; short enough to limit accidental exposure. Confirm or adjust.
7. **Email mask format** — proposing `a***@example.com` (first char + asterisks + domain). Some teams prefer `***@example.com` (full local-part hidden). Confirm.
8. **Privacy notice text** — the in-room footer line is a draft. If you want this reviewed by anyone (legal, faculty group lead) before it ships, flag it now so the implementation PR can ship it correctly the first time.
