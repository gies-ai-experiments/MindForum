# Super-admin archive/delete UI on `/admin/rooms`

**Date:** 2026-05-20
**Status:** Design — approved, pending implementation plan

## Problem

`/admin/rooms` is purely observational. A super-admin can see room status
(ACTIVE / ARCHIVED) and filter on it, but cannot change room lifecycle from
the UI:

- Archive / restore is reachable only from a creator's own
  `/dashboard/rooms/[id]/settings` page.
- Hard-delete (`DELETE /api/room/[id]`) exists as an endpoint but has **no UI
  caller anywhere** — the only way to invoke it today is a manual `curl` with
  the admin cookie.

This feature adds per-room archive, restore, and hard-delete controls to the
super-admin rooms table.

## Auth (already in place — no new plumbing)

`requireRoomOwner` → `getActor()` returns the synthetic `cr_super_admin`
creator row whenever the `ADMIN_TOKEN` cookie is present. A super-admin
authenticated on `/admin/rooms` can therefore call all three endpoints with
the same cookie:

| Endpoint | Auth check | Accepts super-admin? |
|---|---|---|
| `POST /api/room/[id]/archive` | `requireRoomOwner` | yes (via `getActor`) |
| `POST /api/room/[id]/restore` | `requireRoomOwner` (`assertActiveOrOwnerOnArchive`) | yes |
| `DELETE /api/room/[id]` | `isAdmin()` | yes |

## Decisions

- **Delete confirmation:** type-to-confirm the exact room id. Highest safety —
  prevents a misclick on the wrong row, matching the weight of an irreversible
  cascade.
- **Delete gating:** hard-delete is allowed **only on already-archived rooms**.
  Archive acts as a recoverable staging step before permanent deletion. An
  active room cannot be destroyed in one action.

## Approach

Chosen: **"Actions" column + per-row client component, fetch to existing API
routes.** Mirrors the established `CopyLinkButton` / `ArchiveControl` pattern
(client component → `fetch` → API route → `window.location.reload()`). No new
endpoints; one small server-side guard.

Rejected alternatives:

- **Next 15 server actions** — diverges from the codebase's universal "client
  fetch → API route" mutation convention.
- **Dedicated `/admin/rooms/[id]` detail page** — extra navigation for what is
  two buttons; over-built.

## Components

### 1. New `app/admin/rooms/RoomActions.tsx` (`"use client"`)

One instance per table row.

Props:

```ts
{ roomId: string; archived: boolean }
```

State: `busy: boolean`, `err: string | null`, `confirming: boolean`,
`typed: string`.

Behavior:

- **Active room** (`archived === false`): renders an **Archive** button.
  On click → `window.confirm` ("Archive this room? Participants will no longer
  be able to post or join. You can restore it later.") → on OK,
  `POST /api/room/{roomId}/archive` → on 2xx, `window.location.reload()`.

- **Archived room** (`archived === true`): renders **Restore** + **Delete**
  buttons.
  - Restore → `POST /api/room/{roomId}/restore` → reload.
  - Delete → sets `confirming = true`, swapping the cell to the inline
    type-to-confirm state:
    - a text input with placeholder `type the room id to confirm`
    - a red **Delete permanently** button, `disabled` unless
      `typed === roomId` (exact match)
    - a **Cancel** button that resets `confirming` and `typed`
    - On confirm click → `DELETE /api/room/{roomId}` → on 2xx, reload.

- On any non-2xx response: read `body.error`, show inline red error text
  (same style as `ArchiveControl`: `color: "#c00", fontSize: 13`). The row
  stays interactive; `busy` clears in a `finally`.

Button styling follows existing inline-style conventions on the page
(`CopyLinkButton`: `fontSize: 12, padding: "2px 8px"`; destructive actions use
the `ArchiveControl` red palette — `#991b1b` text, `#fecaca` border).

### 2. `app/admin/rooms/page.tsx`

- Add `<th style={{ padding: 8 }}>Actions</th>` to the table header row,
  after the existing `Link` column.
- Add a matching `<td style={{ padding: 8 }}>` per row rendering
  `<RoomActions roomId={r.id} archived={r.archivedAt !== null} />`.
- Import `RoomActions` alongside the existing `CopyLinkButton` import.

No change to `adminListRoomsWithActivity` — `r.id` and `r.archivedAt` are
already in the row shape.

### 3. Atomic archived-only guard — `hardDeleteRoom` + `DELETE /api/room/[id]`

The "delete only archived rooms" rule must be enforced server-side, **and
enforced atomically**. A naive route-level pre-check (`SELECT archived_at`,
then `hardDeleteRoom`) leaves a TOCTOU window: a creator could restore the
room between the check and the delete, and the now-active room is destroyed
anyway.

Fix: push the rule into `hardDeleteRoom` itself (`lib/store.ts`), inside its
existing transaction:

- The internal `DELETE` becomes conditional —
  `DELETE FROM rooms WHERE id = $1 AND archived_at IS NOT NULL`.
- The function returns a discriminated result instead of `snapshot | null`:
  - `{ ok: false, reason: "not_found" }` — the metadata `SELECT` found no row.
  - `{ ok: false, reason: "not_archived" }` — the row exists but the
    conditional `DELETE` affected 0 rows (room is active).
  - `{ ok: true, slug, name, ownerId, messageCount, fileCount }` — deleted.

Because the conditional `DELETE` is the single authority on whether the room
was archived, there is no window — the row's `archived_at` is evaluated at
delete time within the transaction.

The `DELETE /api/room/[id]` handler then switches on the result:
`not_found` → `404 { error: "not_found" }`; `not_archived` →
`409 { error: "not_archived" }`; `ok` → log `room.hard_delete` audit (metadata
= the result fields minus `ok`) and return `200`.

`hardDeleteRoom` has exactly one caller (this route handler), so the signature
change is fully contained.

No changes to the archive or restore endpoints.

## Data flow

```
super-admin on /admin/rooms  (ADMIN_TOKEN cookie)
  → RoomActions button click
  → fetch  POST /api/room/[id]/archive
         | POST /api/room/[id]/restore
         | DELETE /api/room/[id]
  → getActor() resolves cr_super_admin → requireRoomOwner / isAdmin passes
  → store mutation + logAudit (room.archive | room.restore | room.hard_delete)
  → SSE broadcast (archive/restore only — hard-delete has no live room to notify)
  → window.location.reload() → table re-renders with updated status
```

## Error handling

| Case | Behavior |
|---|---|
| Failed fetch / network error | Inline red error in the cell; row stays interactive. |
| `409 not_archived` (stale tab where room was un-archived elsewhere) | Error surfaces inline; a reload clears stale state. |
| Wrong room id typed into the confirm input | Delete button stays `disabled`; no request fires. |
| `404 not_found` (room deleted in another tab) | Error surfaces inline; reload removes the row. |

## Out of scope (YAGNI)

- Bulk select / bulk archive / bulk delete.
- Optimistic UI — full page reload is acceptable for a low-traffic admin tool.
- Audit-log viewer.
- Soft-delete-to-trash / undo for hard-delete.
- Any change to the creator-side `/dashboard` archive control.

## Testing

Manual walk on the VPS, consistent with how creator-rooms v1 was verified
(`curl` + browser). **Do the walk on `/admin/rooms?archived=all`** — the page
defaults to the Active filter, so an archived room would otherwise drop out of
the table and the status change could not be observed in place.

1. On `/admin/rooms?archived=all`, archive an active room → row's Status flips
   to `ARCHIVED`, Actions cell now shows Restore + Delete.
2. Restore it → Status flips back to `ACTIVE`, Actions cell shows only Archive.
3. On an archived room, click Delete, type the wrong id → Delete permanently
   button stays disabled.
4. Type the correct id → confirm → room disappears from the table; verify the
   `room.hard_delete` audit row exists:
   `psql -U mindforum -d mindforum -c "SELECT action, room_id FROM audit_log WHERE action = 'room.hard_delete' ORDER BY at DESC LIMIT 1;"`
   (the `audit_log` timestamp column is `at`, not `created_at`).
5. `curl -X DELETE` on an **active** room with the admin cookie → `409
   not_archived`; room still present.
6. `curl -X DELETE` on a non-existent id → `404 not_found`.
