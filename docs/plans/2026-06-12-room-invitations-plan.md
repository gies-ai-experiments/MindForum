# Room Invitations — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow room owners to invite `allowlisted_creators` to rooms; invited creators see pending invitations in dashboard sidebar, can accept/decline, and accepted rooms appear in "Your rooms" alongside owned rooms. Existing link-based join flow is untouched.

**Architecture:** New `room_invitations` table (schema v13), store-layer CRUD functions, 5 API route files, 2 new client components (InvitationsPanel + PendingInvitations), modified dashboard server component to show invited rooms + invitation badge. The `adminListRoomsWithActivity` query gains a CTE-based union to include rooms where the creator's email has an accepted invitation.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, PostgreSQL, `nanoid`, inline CSS (no Tailwind).

**Design doc:** `docs/plans/2026-06-12-room-invitations-design.md`

---

### Task 1: Schema migration v13 — `room_invitations` table

**Files:**
- Modify: `db/schema.sql` (append after line 248)

**Step 1: Add the migration SQL**

Append after the existing schema migrations (after line 248, before the final empty line):

```sql
-- v13: room invitations. Owners invite allowlisted_creators to discover rooms
-- in their dashboard sidebar. Pending → accepted (room shows in sidebar) or
-- declined. One invitation per email per room (unique index).
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

CREATE UNIQUE INDEX IF NOT EXISTS room_invitations_room_email_uniq
  ON room_invitations (room_id, lower(invitee_email));

INSERT INTO schema_migrations (version) VALUES (13)
  ON CONFLICT (version) DO NOTHING;
```

**Step 2: Apply the migration**

Run: `psql $DATABASE_URL -f db/schema.sql`

**Step 3: Verify the table exists**

Run: `psql $DATABASE_URL -c "\d room_invitations"`

Expected: Table with columns id, room_id, inviter_id, invitee_email, invitee_name, status, created_at, accepted_at, declined_at and the unique index.

**Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "feat: schema v13 — room_invitations table"
```

---

### Task 2: Store types and CRUD functions

**Files:**
- Modify: `lib/store.ts`

**Step 1: Add `RoomInvitation` type**

Insert after the `RoomActivityRow` type (after line 1179):

```typescript
// -------- Room Invitations

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

type InvitationRow = {
  id: string;
  room_id: string;
  room_name: string;
  inviter_id: string;
  inviter_name: string;
  invitee_email: string;
  invitee_name: string;
  status: string;
  created_at: Date;
  accepted_at: Date | null;
  declined_at: Date | null;
};

function toInvitation(r: InvitationRow): RoomInvitation {
  return {
    id: r.id,
    roomId: r.room_id,
    roomName: r.room_name,
    inviterId: r.inviter_id,
    inviterName: r.inviter_name,
    inviteeEmail: r.invitee_email,
    inviteeName: r.invitee_name,
    status: r.status as RoomInvitation["status"],
    createdAt: r.created_at.getTime(),
    acceptedAt: r.accepted_at ? r.accepted_at.getTime() : null,
    declinedAt: r.declined_at ? r.declined_at.getTime() : null,
  };
}
```

**Step 2: Add `createInvitation` function**

```typescript
/** Create an invitation. ON CONFLICT DO NOTHING prevents duplicate invites. */
export async function createInvitation(input: {
  roomId: string;
  inviterId: string;
  inviteeEmail: string;
  inviteeName: string;
}): Promise<
  | { ok: true; invitation: RoomInvitation }
  | { ok: false; error: "already_invited" | "room_not_found" }
> {
  return tx(async (client) => {
    const roomCheck = await client.query<{ name: string }>(
      `SELECT name FROM rooms WHERE id = $1`, [input.roomId]
    );
    if (roomCheck.rowCount === 0) return { ok: false, error: "room_not_found" };

    const inviterRes = await client.query<{ display_name: string }>(
      `SELECT display_name FROM allowlisted_creators WHERE id = $1`,
      [input.inviterId]
    );
    const inviterName = inviterRes.rows[0]?.display_name ?? "Unknown";

    const id = `inv_${nanoid(10)}`;
    const { rows, rowCount } = await client.query<InvitationRow>(
      `INSERT INTO room_invitations (id, room_id, inviter_id, invitee_email, invitee_name, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (room_id, lower(invitee_email)) DO NOTHING
       RETURNING id, room_id, $6 AS room_name, inviter_id, $7 AS inviter_name,
                 invitee_email, invitee_name, status, created_at, accepted_at, declined_at`,
      [id, input.roomId, input.inviterId, input.inviteeEmail, input.inviteeName,
       roomCheck.rows[0].name, inviterName]
    );
    if ((rowCount ?? 0) === 0) return { ok: false, error: "already_invited" };
    return { ok: true, invitation: toInvitation(rows[0]) };
  });
}
```

**Step 3: Add `listInvitationsByRoom`**

```typescript
export async function listInvitationsByRoom(roomId: string): Promise<RoomInvitation[]> {
  const { rows } = await query<InvitationRow>(
    `SELECT inv.id, inv.room_id, r.name AS room_name, inv.inviter_id,
            c.display_name AS inviter_name, inv.invitee_email, inv.invitee_name,
            inv.status, inv.created_at, inv.accepted_at, inv.declined_at
     FROM room_invitations inv
     JOIN rooms r ON r.id = inv.room_id
     LEFT JOIN allowlisted_creators c ON c.id = inv.inviter_id
     WHERE inv.room_id = $1
     ORDER BY inv.created_at DESC`,
    [roomId]
  );
  return rows.map(toInvitation);
}
```

**Step 4: Add `listPendingInvitationsByEmail`**

```typescript
export async function listPendingInvitationsByEmail(email: string): Promise<RoomInvitation[]> {
  const { rows } = await query<InvitationRow>(
    `SELECT inv.id, inv.room_id, r.name AS room_name, inv.inviter_id,
            c.display_name AS inviter_name, inv.invitee_email, inv.invitee_name,
            inv.status, inv.created_at, inv.accepted_at, inv.declined_at
     FROM room_invitations inv
     JOIN rooms r ON r.id = inv.room_id
     LEFT JOIN allowlisted_creators c ON c.id = inv.inviter_id
     WHERE lower(inv.invitee_email) = lower($1)
       AND inv.status = 'pending'
     ORDER BY inv.created_at DESC`,
    [email]
  );
  return rows.map(toInvitation);
}
```

**Step 5: Add `updateInvitationStatus`**

```typescript
export async function updateInvitationStatus(
  id: string,
  email: string,
  status: "accepted" | "declined"
): Promise<RoomInvitation | null> {
  const timestampCol = status === "accepted" ? "accepted_at" : "declined_at";
  const { rows } = await query<InvitationRow>(
    `UPDATE room_invitations
     SET status = $3, ${timestampCol} = NOW()
     WHERE id = $1 AND lower(invitee_email) = lower($2) AND status = 'pending'
     RETURNING id, room_id, '' AS room_name, inviter_id, '' AS inviter_name,
               invitee_email, invitee_name, status, created_at, accepted_at, declined_at`,
    [id, email, status]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  // Backfill names for the return value
  const [roomRes, inviterRes] = await Promise.all([
    query<{ name: string }>(`SELECT name FROM rooms WHERE id = $1`, [row.room_id]),
    query<{ display_name: string }>(`SELECT display_name FROM allowlisted_creators WHERE id = $1`, [row.inviter_id]),
  ]);
  return toInvitation({
    ...row,
    room_name: roomRes.rows[0]?.name ?? "",
    inviter_name: inviterRes.rows[0]?.display_name ?? "Unknown",
  });
}
```

**Step 6: Add `cancelInvitation`**

```typescript
export async function cancelInvitation(id: string): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM room_invitations WHERE id = $1 AND status = 'pending'`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}
```

**Step 7: Add `lookupCreators`**

```typescript
export async function lookupCreators(q: string): Promise<{ id: string; email: string; displayName: string }[]> {
  if (!q || q.trim().length < 1) return [];
  const { rows } = await query<{ id: string; email: string; display_name: string }>(
    `SELECT id, email, display_name FROM allowlisted_creators
     WHERE (lower(email) LIKE '%' || lower($1) || '%'
            OR lower(display_name) LIKE '%' || lower($1) || '%')
       AND disabled_at IS NULL
       AND id != 'cr_super_admin'
     ORDER BY display_name ASC
     LIMIT 5`,
    [q.trim()]
  );
  return rows.map((r) => ({ id: r.id, email: r.email, displayName: r.display_name }));
}
```

**Step 8: Modify `adminListRoomsWithActivity` — add `inviteeEmail` parameter and invited-room union**

Add `inviteeEmail?: string` to the `opts` parameter. Replace the WHERE clause with a CTE-based approach. Change the function body to:

The key change: when `inviteeEmail` is provided, the query uses a CTE that unions `owner_id` rooms with `accepted` invitation rooms:

```sql
WITH accessible_rooms AS (
  SELECT r.id FROM rooms r WHERE r.owner_id = $2
  UNION
  SELECT inv.room_id FROM room_invitations inv
  WHERE lower(inv.invitee_email) = lower($4) AND inv.status = 'accepted'
)
SELECT r.*, c.display_name AS owner_display_name, ...,
  CASE WHEN r.owner_id = $2 THEN 'owner' ELSE 'invited' END AS relationship
FROM rooms r
JOIN accessible_rooms ar ON ar.id = r.id
LEFT JOIN messages m ON m.room_id = r.id
LEFT JOIN allowlisted_creators c ON c.id = r.owner_id
WHERE ($1::text IS NULL OR r.name ILIKE '%' || $1 || '%')
  ${archivedClause}
GROUP BY r.id, c.display_name
ORDER BY ${column} ${direction} NULLS LAST
```

Add `relationship: "owner" | "invited"` to the `RoomActivityRow` type.

**Step 9: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 10: Commit**

```bash
git add lib/store.ts
git commit -m "feat: store functions for room invitations"
```

---

### Task 3: Creator lookup API route

**Files:**
- Create: `app/api/dashboard/creators/lookup/route.ts`

**Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse, requireJsonContent } from "@/lib/creator-auth";
import { lookupCreators } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireCreator();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const results = await lookupCreators(q);
    return NextResponse.json(results);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
```

**Step 2: Verify route works**

Run: `curl -s "http://localhost:3000/api/dashboard/creators/lookup?q=a" -H "Cookie: mindforum_creator_session=<valid-token>" | jq .`

Expected: JSON array of matching creators.

**Step 3: Commit**

```bash
git add app/api/dashboard/creators/lookup/route.ts
git commit -m "feat: creator lookup API for invite autocomplete"
```

---

### Task 4: Room invitations API (create + list)

**Files:**
- Create: `app/api/admin/rooms/[id]/invitations/route.ts`

**Step 1: Create the route with POST (create) and GET (list)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse, requireRoomOwner, requireJsonContent } from "@/lib/creator-auth";
import { createInvitation, listInvitationsByRoom } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireRoomOwner(id);
    const invitations = await listInvitationsByRoom(id);
    return NextResponse.json(invitations);
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireJsonContent(req);
    const { id } = await params;
    const { actor } = await requireRoomOwner(id);
    const body = await req.json();
    const { inviteeEmail, inviteeName } = body;

    if (!inviteeEmail || typeof inviteeEmail !== "string" || !inviteeEmail.includes("@")) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (!inviteeName || typeof inviteeName !== "string" || !inviteeName.trim()) {
      return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    }

    const result = await createInvitation({
      roomId: id,
      inviterId: actor.id,
      inviteeEmail: inviteeEmail.trim(),
      inviteeName: inviteeName.trim(),
    });

    if (!result.ok) {
      const status = result.error === "room_not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result.invitation, { status: 201 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
```

**Step 2: Verify**

Run: 
```bash
# GET should return empty array for a room with no invites
curl -s "http://localhost:3000/api/admin/rooms/<room-id>/invitations" \
  -H "Cookie: mindforum_creator_session=<token>" | jq .

# POST should create an invitation
curl -s -X POST "http://localhost:3000/api/admin/rooms/<room-id>/invitations" \
  -H "Cookie: mindforum_creator_session=<token>" \
  -H "Content-Type: application/json" \
  -d '{"inviteeEmail":"test@example.com","inviteeName":"Test User"}' | jq .
```

Expected: 200 with empty array for GET; 201 with invitation object for POST.

**Step 3: Commit**

```bash
git add app/api/admin/rooms/[id]/invitations/route.ts
git commit -m "feat: room invitations create + list API"
```

---

### Task 5: Cancel invitation API route

**Files:**
- Create: `app/api/admin/rooms/[id]/invitations/[invId]/route.ts`

**Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse, requireRoomOwner } from "@/lib/creator-auth";
import { cancelInvitation } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; invId: string }> }
) {
  try {
    const { id, invId } = await params;
    await requireRoomOwner(id);
    const deleted = await cancelInvitation(invId);
    if (!deleted) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
```

**Step 2: Verify**

Run:
```bash
curl -s -X DELETE "http://localhost:3000/api/admin/rooms/<room-id>/invitations/<inv-id>" \
  -H "Cookie: mindforum_creator_session=<token>" | jq .
```

Expected: `{ "ok": true }` or 404.

**Step 3: Commit**

```bash
git add app/api/admin/rooms/[id]/invitations/[invId]/route.ts
git commit -m "feat: cancel invitation API"
```

---

### Task 6: Dashboard invitations API (pending + accept/decline)

**Files:**
- Create: `app/api/dashboard/invitations/route.ts`
- Create: `app/api/dashboard/invitations/[id]/route.ts`

**Step 1: Create pending invitations list route**

`app/api/dashboard/invitations/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse } from "@/lib/creator-auth";
import { listPendingInvitationsByEmail } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const creator = await requireCreator();
    const invitations = await listPendingInvitationsByEmail(creator.email);
    return NextResponse.json(invitations);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
```

**Step 2: Create accept/decline route**

`app/api/dashboard/invitations/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireCreator, httpErrorResponse, requireJsonContent } from "@/lib/creator-auth";
import { updateInvitationStatus } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireJsonContent(req);
    const { id } = await params;
    const creator = await requireCreator();
    const body = await req.json();
    const action = body.action;

    if (action !== "accept" && action !== "decline") {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }

    const result = await updateInvitationStatus(id, creator.email, action);
    if (!result) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
```

**Step 3: Verify**

Run:
```bash
# Check pending
curl -s "http://localhost:3000/api/dashboard/invitations" \
  -H "Cookie: mindforum_creator_session=<invitee-token>" | jq .

# Accept
curl -s -X POST "http://localhost:3000/api/dashboard/invitations/<inv-id>" \
  -H "Cookie: mindforum_creator_session=<invitee-token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"accept"}' | jq .
```

Expected: array of pending for GET; accepted invitation for POST.

**Step 4: Commit**

```bash
git add app/api/dashboard/invitations/route.ts app/api/dashboard/invitations/[id]/route.ts
git commit -m "feat: dashboard invitations list + accept/decline API"
```

---

### Task 7: InvitationsPanel client component

**Files:**
- Create: `app/dashboard/rooms/[id]/settings/InvitationsPanel.tsx`

**Step 1: Create the component**

A client component with:
- State: `invitations`, `email`, `name`, `suggestions`, `busy`, `err`
- Debounced `email` change → fetch `GET /api/dashboard/creators/lookup?q=` → populate `suggestions`
- Selecting a suggestion fills both `email` and `name`
- "Send Invite" button → `POST /api/admin/rooms/[id]/invitations` with `{ inviteeEmail, inviteeName }`
- On success, append to `invitations` list
- Table rendering each invitation with status pill, Cancel button for pending
- Fetch invitations on mount via `GET /api/admin/rooms/[id]/invitations`
- Disabled when `archived === true`

Component structure:

```typescript
"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type Invitation = {
  id: string;
  inviteeEmail: string;
  inviteeName: string;
  status: "pending" | "accepted" | "declined";
  inviterName: string;
  createdAt: number;
  acceptedAt: number | null;
  declinedAt: number | null;
};

type CreatorSuggestion = {
  id: string;
  email: string;
  displayName: string;
};

export default function InvitationsPanel({
  roomId,
  archived,
}: {
  roomId: string;
  archived: boolean;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [suggestions, setSuggestions] = useState<CreatorSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Load invitations on mount
  useEffect(() => {
    fetch(`/api/admin/rooms/${roomId}/invitations`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setInvitations)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [roomId]);

  // Debounced creator lookup
  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dashboard/creators/lookup?q=${encodeURIComponent(value.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
        }
      } catch { /* ignore */ }
    }, 300);
  }, []);

  function selectSuggestion(s: CreatorSuggestion) {
    setEmail(s.email);
    setName(s.displayName);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeEmail: email.trim(), inviteeName: name.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInvitations((cur) => [data, ...cur]);
        setEmail("");
        setName("");
        setSuggestions([]);
        setShowSuggestions(false);
      } else {
        setErr(data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(invId: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}/invitations/${invId}`, { method: "DELETE" });
      if (res.ok || res.status === 204) {
        setInvitations((cur) => cur.filter((i) => i.id !== invId));
      } else {
        const body = await res.json().catch(() => ({}));
        setErr(body.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function statusPill(status: string) {
    const colors: Record<string, { bg: string; fg: string }> = {
      pending: { bg: "#F3F4F6", fg: "#6B7280" },
      accepted: { bg: "#DCFCE7", fg: "#166534" },
      declined: { bg: "#FEE2E2", fg: "#991B1B" },
    };
    const c = colors[status] ?? colors.pending;
    return (
      <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", background: c.bg, color: c.fg }}>
        {status.toUpperCase()}
      </span>
    );
  }

  if (!loaded) return <p style={{ color: "#666", fontSize: 13 }}>Loading…</p>;

  return (
    <div>
      {err && <p role="alert" style={{ color: "#c00", fontSize: 13, marginTop: 0 }}>{err}</p>}

      {/* Send invite form */}
      {!archived && (
        <div style={{ marginBottom: 20, position: "relative" }}>
          <form onSubmit={sendInvite} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 200px", position: "relative" }}>
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                disabled={busy}
                style={{ width: "100%", padding: "6px 10px", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 6, boxSizing: "border-box" }}
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1px solid #e5e7eb", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 10, maxHeight: 200, overflowY: "auto" }}>
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={() => selectSuggestion(s)}
                      style={{ display: "block", width: "100%", padding: "8px 10px", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontSize: 13 }}
                    >
                      <span style={{ fontWeight: 600 }}>{s.displayName}</span>
                      <span style={{ color: "#888", marginLeft: 8 }}>{s.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              style={{ flex: "1 1 150px", padding: "6px 10px", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 6 }}
            />
            <button
              type="submit"
              disabled={busy || !email.trim() || !name.trim()}
              style={{ padding: "6px 16px", fontSize: 13, fontWeight: 600, background: busy ? "#D1D5DB" : "var(--orange)", color: "white", border: "none", borderRadius: 6, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {busy ? "Sending…" : "Send Invite"}
            </button>
          </form>
        </div>
      )}

      {/* Invitation list */}
      {invitations.length === 0 ? (
        <p style={{ color: "#666", fontSize: 13 }}>No invitations sent yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
              <th style={{ padding: 6, fontSize: 13 }}>Name</th>
              <th style={{ padding: 6, fontSize: 13 }}>Email</th>
              <th style={{ padding: 6, fontSize: 13 }}>Status</th>
              <th style={{ padding: 6, fontSize: 13 }}>Sent</th>
              <th style={{ padding: 6, fontSize: 13 }}></th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((inv) => (
              <tr key={inv.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td style={{ padding: 6, fontSize: 14 }}>{inv.inviteeName}</td>
                <td style={{ padding: 6, fontSize: 13, color: "#666" }}>{inv.inviteeEmail}</td>
                <td style={{ padding: 6 }}>{statusPill(inv.status)}</td>
                <td style={{ padding: 6, fontSize: 13, color: "#666" }}>
                  {new Date(inv.createdAt).toISOString().slice(0, 10)}
                </td>
                <td style={{ padding: 6, fontSize: 13, textAlign: "right" }}>
                  {inv.status === "pending" && !archived && (
                    <button
                      type="button"
                      onClick={() => cancel(inv.id)}
                      disabled={busy}
                      style={{ padding: "4px 10px", fontSize: 12, background: "white", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

**Step 2: Integrate into settings page**

Modify `app/dashboard/rooms/[id]/settings/page.tsx`:
- Import `InvitationsPanel`
- Add an Invitations section after the Participants section (after line 116):

```tsx
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Invitations</h2>
        <InvitationsPanel roomId={room.id} archived={archived} />
      </section>
```

**Step 3: Verify type check**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add app/dashboard/rooms/[id]/settings/InvitationsPanel.tsx app/dashboard/rooms/[id]/settings/page.tsx
git commit -m "feat: InvitationsPanel in room settings"
```

---

### Task 8: PendingInvitations client component (dashboard)

**Files:**
- Create: `app/dashboard/PendingInvitations.tsx`

**Step 1: Create the component**

A client component that displays pending invitations with room name, inviter name, and Accept/Decline buttons. On accept, the parent page should refresh to show the new room.

```typescript
"use client";

import { useState, useEffect } from "react";

type Invitation = {
  id: string;
  roomId: string;
  roomName: string;
  inviterName: string;
  inviteeName: string;
  createdAt: number;
};

export default function PendingInvitations() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/invitations")
      .then((res) => (res.ok ? res.json() : []))
      .then(setInvitations)
      .catch(() => {});
  }, []);

  async function respond(invId: string, action: "accept" | "decline") {
    setBusyId(invId);
    setErr(null);
    try {
      const res = await fetch(`/api/dashboard/invitations/${invId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setInvitations((cur) => cur.filter((i) => i.id !== invId));
        if (action === "accept") {
          window.location.reload(); // refresh to show room in "Your rooms"
        }
      } else {
        const body = await res.json().catch(() => ({}));
        setErr(body.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (invitations.length === 0) {
    return null; // component is only rendered when count > 0, but handle reload
  }

  return (
    <div className="dash-panel" id="invitations">
      <div className="dash-panel__head">
        <span className="dash-panel__title">Pending invitations<span>from other room owners</span></span>
      </div>
      <div className="dash-panel__body">
        {err && <p role="alert" style={{ color: "#c00", fontSize: 13 }}>{err}</p>}
        <table className="dash-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>From</th>
              <th>Sent</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <a className="dash-roomname" href={`/dashboard/rooms/${inv.roomId}/settings`}>
                    {inv.roomName}
                  </a>
                </td>
                <td style={{ fontSize: 13, color: "#666" }}>{inv.inviterName}</td>
                <td style={{ fontSize: 13, color: "#666" }}>
                  {new Date(inv.createdAt).toISOString().slice(0, 10)}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => respond(inv.id, "accept")}
                    disabled={busyId === inv.id}
                    style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, background: busyId === inv.id ? "#86EFAC" : "#22C55E", color: "white", border: "none", borderRadius: 4, cursor: busyId === inv.id ? "not-allowed" : "pointer", marginRight: 6 }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(inv.id, "decline")}
                    disabled={busyId === inv.id}
                    style={{ padding: "4px 12px", fontSize: 12, background: "white", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 4, cursor: busyId === inv.id ? "not-allowed" : "pointer" }}
                  >
                    Decline
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add app/dashboard/PendingInvitations.tsx
git commit -m "feat: PendingInvitations component for dashboard"
```

---

### Task 9: Dashboard page changes (invited rooms + sidebar badge)

**Files:**
- Modify: `app/dashboard/page.tsx`

**Step 1: Import new dependencies and fetch invitation data**

Add imports:
```typescript
import { listPendingInvitationsByEmail } from "@/lib/store";
import PendingInvitations from "./PendingInvitations";
```

After `const creator = await getCreator();` (line 98), add:
```typescript
const pendingCount = creator
  ? (await listPendingInvitationsByEmail(creator.email)).length
  : 0;
```

**Step 2: Modify `adminListRoomsWithActivity` call to include invited rooms**

Change the call (line 115-120) to pass `inviteeEmail`:
```typescript
const allRows = await adminListRoomsWithActivity({
  column: "last_message_at",
  direction: "DESC",
  ownerId: creator.id,
  inviteeEmail: creator.email,
  archived: "all",
});
```

Note: for this to work with `archived: "all"`, the function needs to support both `ownerId` and `inviteeEmail` simultaneously.

**Step 3: Update the `RoomActivityRow` type usage**

The `RoomActivityRow` now has a `relationship` field. Use it to render the appropriate pill in the table:

In the `displayRows.map` (line 301), change the status column:
```tsx
<td>
  {r.relationship === "invited" ? (
    <span className="dash-pill dash-pill--invited">INVITED</span>
  ) : isArchived ? (
    <span className="dash-pill dash-pill--archived">ARCHIVED</span>
  ) : (
    <span className="dash-pill dash-pill--active">ACTIVE</span>
  )}
</td>
```

**Step 4: Add "Invitations" nav item in sidebar**

After the "Your rooms" nav item (after line 169), add:
```tsx
{pendingCount > 0 && (
  <a className="dash-navitem" href="#invitations">
    {Icon.rooms}<span className="dash-navtext">Invitations</span>
    <span className="dash-invite-badge">{pendingCount}</span>
  </a>
)}
```

We need an invitations icon. Add to the Icon object:
```typescript
mail: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
),
```

And use `Icon.mail` in the nav item.

**Step 5: Add PendingInvitations panel in the main content**

After the "Your rooms" section (after the closing `</section>` of the rooms table, before the "Create room" section), add:
```tsx
{pendingCount > 0 && <PendingInvitations />}
```

**Step 6: Add CSS**

In `app/globals.css`, add the new styles:

```css
.dash-pill--invited { background: #DBEAFE; color: #1E40AF; }

.dash-invite-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 5px;
  border-radius: 10px; background: var(--orange); color: white;
  font-size: 11px; font-weight: 700; margin-left: auto;
}
```

**Step 7: Verify type check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 8: Build test**

Run: `npm run build`
Expected: Successful build.

**Step 9: Commit**

```bash
git add app/dashboard/page.tsx app/globals.css
git commit -m "feat: invited rooms in dashboard + sidebar invitation badge"
```

---

### Task 10: End-to-end verification and final commit

**Step 1: Full build**

Run: `npm run build`
Expected: No errors.

**Step 2: Manual E2E test steps**

1. Start dev server: `npm run dev`
2. Sign in as Creator A (room owner)
3. Create a room
4. Go to room settings → Invitations section
5. Send an invite to Creator B's email
6. Verify: Creator A sees the invitation as "pending"
7. Sign in as Creator B
8. Verify: "Invitations (1)" badge appears in sidebar
9. Click "Invitations" → see the pending invitation
10. Click "Accept"
11. Verify: room now appears in "Your rooms" with "INVITED" pill
12. Sign in as Creator A → Verify invitation now shows "accepted"

**Step 3: Smoke test: existing flow preserved**

1. Open a room link in incognito
2. Join with name + email as a participant
3. Verify: can send messages, the room works as before
4. Verify: no invitation-related errors in dashboard for non-invited creators

**Step 4: Final commit if any fixes**

```bash
# Fix any issues discovered, then:
git add -A
git commit -m "fix: E2E fixes for room invitations"
```

---

> **Summary:** 10 tasks, ~7 files created, ~3 files modified. Schema migration, store layer, 5 API route files, 2 UI components, dashboard integration.
