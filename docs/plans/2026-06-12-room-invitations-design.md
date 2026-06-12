# Room Invitations — Design

## Summary

Allow room owners to invite `allowlisted_creators` (authenticated dashboard users) to their rooms. Invited creators see pending invitations in the dashboard sidebar, can accept/decline them, and see accepted rooms listed under "Your rooms" alongside rooms they own.

The existing link-based join flow (`POST /api/room/[id]/join`) is untouched — anyone with the link still joins as a `participant`. Invitations are a separate, additive mechanism for creator-to-creator room discovery.

## Database

New table: `room_invitations`

```sql
CREATE TABLE IF NOT EXISTS room_invitations (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  inviter_id    TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  invitee_name  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','accepted','declined')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at   TIMESTAMPTZ,
  declined_at   TIMESTAMPTZ
);

-- One invitation per email per room
CREATE UNIQUE INDEX IF NOT EXISTS room_invitations_room_email_uniq
  ON room_invitations (room_id, lower(invitee_email));
```

Schema migration version: 13.

## Store layer (`lib/store.ts`)

### Invitation CRUD

- `createInvitation(roomId, inviterId, inviteeEmail, inviteeName)` — INSERT with ON CONFLICT guard; returns `{ ok, invitation }` or `{ ok: false, error: "already_invited" }`
- `listInvitationsByRoom(roomId)` — all invitations for a room (used by room settings page)
- `listPendingInvitationsByEmail(email)` — pending invitations for a creator (used by dashboard sidebar badge)
- `updateInvitationStatus(id, email, status)` — accept/decline; validates invitee_email matches
- `cancelInvitation(id)` — delete a pending invitation (owner-only)

### Dashboard query changes

- `adminListRoomsWithActivity` gains an `inviteeEmail` parameter. When provided, the query unions `ownerId` rooms with rooms where the creator's email matches an `accepted` invitation in `room_invitations`. Each row includes a new field `relationship: "owner" | "invited"` so the UI can render the appropriate pill.

### Invitation types

```typescript
export type RoomInvitation = {
  id: string;
  roomId: string;
  roomName: string;
  inviterId: string;
  inviterName: string;
  inviteeEmail: string;
  inviteeName: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
  acceptedAt: number | null;
  declinedAt: number | null;
};
```

## API routes

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/admin/creators/lookup?q=` | Fuzzy search creators by email/name (for invite form autocomplete) | Creator cookie |
| `POST` | `/api/admin/rooms/[id]/invitations` | Create invitation | Room owner |
| `GET` | `/api/admin/rooms/[id]/invitations` | List invitations for room settings | Room owner |
| `DELETE` | `/api/admin/rooms/[id]/invitations/[invId]` | Cancel pending invitation | Room owner |
| `GET` | `/api/dashboard/invitations` | Current creator's pending invitations (for sidebar badge) | Creator cookie |
| `POST` | `/api/dashboard/invitations/[id]/accept` | Accept invitation | Creator cookie (email match) |
| `POST` | `/api/dashboard/invitations/[id]/decline` | Decline invitation | Creator cookie (email match) |

All routes validate content-type (`application/json`) for CSRF protection (same as existing endpoints).

## UI components

### 1. Room Settings — InvitationsPanel (`app/dashboard/rooms/[id]/settings/InvitationsPanel.tsx`)

Client component. Two sections:

- **Send invite form**: email input + name input + "Send Invite" button. Email input triggers an autocomplete dropdown that calls `GET /api/admin/creators/lookup?q=` for fuzzy matching against `allowlisted_creators`. Selecting a match auto-fills both name and email. Disabled when room is archived.

- **Invitation list**: table showing invitee name, email, status (with color-coded pill: pending/grey, accepted/green, declined/red), sent date, and a "Cancel" button for pending invitations.

### 2. Dashboard sidebar — invited rooms

The "Your rooms" section in the sidebar currently shows rooms filtered by `ownerId`. After this change:

- Rooms where `relationship === "owner"` render the existing "ACTIVE"/"ARCHIVED" pill.
- Rooms where `relationship === "invited"` render an "INVITED" pill (same visual style, different color).
- The "Your rooms" list label remains the same; both owned and invited rooms appear together.
- Archive/Active/All tabs work the same way.

### 3. Dashboard sidebar — invitations nav item

A new "Invitations" nav item appears between "Your rooms" and "Create room" in the sidebar, **only when** the creator has `pending > 0` invitations. It shows `"Invitations"` and a count badge.

Clicking it scrolls to a new section below "Your rooms" in the main content area that displays the pending invitations with room name, inviter name, and Accept/Decline buttons.

### 4. Dashboard server component changes

The dashboard page:
- Fetches pending invitation count via `getCreator()` email → `listPendingInvitationsByEmail()`
- Passes `inviteeEmail` to `adminListRoomsWithActivity` to include invited rooms
- Renders the "Invitations" nav item conditionally
- Renders the pending invitations panel when the user navigates to it

## Invitation matching UX

When the owner types in the invite form:

1. On each keystroke (debounced 300ms), fetch `GET /api/admin/creators/lookup?q=<typed>` 
2. Display up to 5 matching `allowlisted_creators` with name + email
3. Selecting a match fills both fields automatically
4. If no match found, the owner manually enters name + email
5. On submit, the invitation is created regardless of whether the email matched a creator — it becomes discoverable if/when that email registers as a creator later

## Scope / Non-goals

- **NO** email sending — invitations are in-app only (visible in dashboard)
- **NO** notification system — the "Invitations" badge in the sidebar is the notification
- **NO** auto-add to participants — accepting an invitation does NOT add the creator as a participant; that still happens via the existing link-join flow
- **NO** permission changes — invited rooms are read-only in the dashboard (can't edit settings unless owner)

## Existing flow preserved

The link-based participant join (`POST /api/room/[id]/join`) is completely unchanged. Invitations operate on a separate table and only affect the dashboard view — they do not interact with `participants` rows at all.
