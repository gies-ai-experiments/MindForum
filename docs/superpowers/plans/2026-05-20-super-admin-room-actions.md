# Super-admin Room Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-room archive, restore, and hard-delete controls to the super-admin `/admin/rooms` table.

**Architecture:** A new `"use client"` component (`RoomActions.tsx`) renders one cell per table row and calls the three existing room-lifecycle API routes via `fetch`, then reloads the page. The `DELETE /api/room/[id]` route gets a server-side guard so hard-delete is refused on non-archived rooms. No new endpoints, no new auth — the `ADMIN_TOKEN` cookie already resolves to `cr_super_admin` through `getActor()`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, server-rendered admin page + client component, inline styles (codebase convention).

**Spec:** `docs/superpowers/specs/2026-05-20-super-admin-room-actions-design.md`

---

## File Structure

- **Modify** `lib/store.ts` — `hardDeleteRoom` enforces archived-only atomically and returns a discriminated result.
- **Modify** `app/api/room/[id]/route.ts` — `DELETE` handler maps the discriminated result to `200` / `404` / `409`.
- **Create** `app/admin/rooms/RoomActions.tsx` — client component with archive / restore / type-to-confirm-delete controls.
- **Modify** `app/admin/rooms/page.tsx` — import `RoomActions`, add the `Actions` column header and per-row cell.

No schema or auth changes.

---

## Task 1: Atomic archived-only hard-delete guard

**Files:**
- Modify: `lib/store.ts` (the `hardDeleteRoom` function, currently near line 1100)
- Modify: `app/api/room/[id]/route.ts` (the `DELETE` handler, currently lines 100-121)

The "delete only archived rooms" rule must be enforced server-side **and
atomically**. A route-level `SELECT archived_at` pre-check followed by a
separate delete leaves a TOCTOU window (a creator could restore the room in
between). Instead, push the rule into `hardDeleteRoom`'s existing transaction:
the `DELETE` itself becomes conditional on `archived_at IS NOT NULL`, which is
the single, race-free authority on the rule.

Both files must change together — `hardDeleteRoom`'s return type changes from
`snapshot | null` to a discriminated result, and the route is its only caller.
One commit.

- [ ] **Step 1: Rewrite `hardDeleteRoom` in `lib/store.ts`**

Replace the entire existing `hardDeleteRoom` function (and its doc comment)
with:

```ts
/**
 * Hard-delete a room. ONLY deletes archived rooms — the conditional DELETE
 * (`archived_at IS NOT NULL`) is the single, atomic authority on the
 * archived-only rule, so there is no check-then-act race.
 *
 * Cascade hits messages, message_reactions, participants, room_files via the
 * existing ON DELETE CASCADE on `rooms.id`. Audit log rows survive (no FK on
 * `audit_log.room_id` is intentional — see schema v8 comment).
 *
 * Returns a discriminated result:
 *  - { ok: false, reason: "not_found" }    — no such room
 *  - { ok: false, reason: "not_archived" } — room exists but is active
 *  - { ok: true, ... }                     — room deleted
 */
export async function hardDeleteRoom(id: string): Promise<
  | {
      ok: true;
      slug: string;
      name: string;
      ownerId: string;
      messageCount: number;
      fileCount: number;
    }
  | { ok: false; reason: "not_found" | "not_archived" }
> {
  return tx(async (client) => {
    const meta = await client.query<{
      id: string;
      name: string;
      owner_id: string;
      message_count: string;
      file_count: string;
    }>(
      `SELECT
         r.id,
         r.name,
         r.owner_id,
         (SELECT COUNT(*)::text FROM messages   m WHERE m.room_id = r.id) AS message_count,
         (SELECT COUNT(*)::text FROM room_files f WHERE f.room_id = r.id) AS file_count
       FROM rooms r WHERE r.id = $1`,
      [id]
    );
    if (meta.rowCount === 0) return { ok: false, reason: "not_found" };
    const m = meta.rows[0];

    // Conditional delete IS the archived-only enforcement: an active room
    // matches 0 rows. Evaluated at delete time inside the transaction.
    const del = await client.query(
      `DELETE FROM rooms WHERE id = $1 AND archived_at IS NOT NULL`,
      [id]
    );
    if ((del.rowCount ?? 0) === 0) return { ok: false, reason: "not_archived" };

    return {
      ok: true,
      slug: m.id,
      name: m.name,
      ownerId: m.owner_id,
      messageCount: parseInt(m.message_count, 10),
      fileCount: parseInt(m.file_count, 10),
    };
  });
}
```

(`tx` is already imported in `lib/store.ts` — the current `hardDeleteRoom`
already uses it.)

- [ ] **Step 2: Rewrite the `DELETE` handler in `app/api/room/[id]/route.ts`**

Replace the entire existing `DELETE` function (the block starting at
`export async function DELETE`, currently lines 100-121) with:

```ts
/**
 * DELETE: super-admin hard-delete. Refused on active rooms (`409
 * not_archived`) — a room must be archived first; archive is the recoverable
 * staging step. The archived-only rule is enforced atomically inside
 * `hardDeleteRoom` (see lib/store.ts). Audit row is written after the delete
 * returns so the snapshot metadata reflects the row that just disappeared.
 *
 * Creator path is NOT supported here. Creators archive; only super-admin
 * destroys.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await ctx.params;
    const result = await hardDeleteRoom(id);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.reason }, { status });
    }
    const snap = {
      slug: result.slug,
      name: result.name,
      ownerId: result.ownerId,
      messageCount: result.messageCount,
      fileCount: result.fileCount,
    };
    const actor = await getActor();
    if (actor) {
      await logAudit({
        actor,
        action: "room.hard_delete",
        roomId: id,
        metadata: snap,
      });
    }
    return NextResponse.json({ ok: true, ...snap });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
```

Note: do not remove the `query` import from this file — the `PATCH` handler
above still uses it.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (`isAdmin`,
`hardDeleteRoom`, `getActor`, `logAudit`, `httpErrorResponse` are all already
imported in `route.ts`.)

- [ ] **Step 4: Commit**

```bash
git add lib/store.ts app/api/room/[id]/route.ts
git commit -m "feat: enforce archived-only hard-delete atomically in hardDeleteRoom"
```

---

## Task 2: `RoomActions` client component

**Files:**
- Create: `app/admin/rooms/RoomActions.tsx`

This component renders the action cell for one room row. It mirrors the existing `CopyLinkButton.tsx` (client component, inline styles) and `ArchiveControl.tsx` (fetch → reload → inline error) patterns.

- [ ] **Step 1: Create the component**

Create `app/admin/rooms/RoomActions.tsx` with exactly this content:

```tsx
"use client";

import { useState, type CSSProperties } from "react";

/**
 * Super-admin per-row room lifecycle controls for /admin/rooms.
 *
 * Active room   → Archive button.
 * Archived room → Restore button + Delete button. Delete swaps the cell to an
 *                 inline type-to-confirm state: the exact room id must be typed
 *                 before the destructive request fires.
 *
 * All three actions hit existing API routes; the ADMIN_TOKEN cookie resolves
 * to cr_super_admin via getActor(), so no extra auth is needed. On success the
 * page is reloaded so the server-rendered table reflects the new status.
 */
export default function RoomActions({
  roomId,
  archived,
}: {
  roomId: string;
  archived: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  async function send(method: "POST" | "DELETE", path: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(path, { method });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setErr(body.error ?? `HTTP ${res.status}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function archive() {
    const ok = window.confirm(
      "Archive this room? Participants will no longer be able to post or join. You can restore it later."
    );
    if (!ok) return;
    void send("POST", `/api/room/${roomId}/archive`);
  }

  function restore() {
    void send("POST", `/api/room/${roomId}/restore`);
  }

  function del() {
    void send("DELETE", `/api/room/${roomId}`);
  }

  const btn: CSSProperties = {
    fontSize: 12,
    padding: "2px 8px",
    cursor: busy ? "wait" : "pointer",
    marginRight: 6,
  };
  const danger: CSSProperties = {
    ...btn,
    color: "#991b1b",
    border: "1px solid #fecaca",
    background: "white",
  };

  if (confirming) {
    return (
      <div>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="type the room id to confirm"
          aria-label="type the room id to confirm deletion"
          style={{ fontSize: 12, padding: "2px 6px", width: 180 }}
        />
        <button
          type="button"
          onClick={del}
          disabled={busy || typed !== roomId}
          style={{
            ...danger,
            marginLeft: 6,
            background: typed === roomId ? "#991b1b" : "white",
            color: typed === roomId ? "white" : "#991b1b",
            cursor: typed === roomId && !busy ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "…" : "Delete permanently"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setTyped("");
            setErr(null);
          }}
          disabled={busy}
          style={{ ...btn, marginLeft: 6 }}
        >
          Cancel
        </button>
        {err && (
          <span style={{ marginLeft: 8, color: "#c00", fontSize: 13 }}>{err}</span>
        )}
      </div>
    );
  }

  return (
    <div>
      {archived ? (
        <>
          <button type="button" onClick={restore} disabled={busy} style={btn}>
            {busy ? "…" : "Restore"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            style={danger}
          >
            Delete
          </button>
        </>
      ) : (
        <button type="button" onClick={archive} disabled={busy} style={danger}>
          {busy ? "…" : "Archive"}
        </button>
      )}
      {err && (
        <span style={{ marginLeft: 8, color: "#c00", fontSize: 13 }}>{err}</span>
      )}
    </div>
  );
}
```

Note: the `roomName` prop from the spec was dropped — the confirm input matches against `roomId` (the value typed), and `window.confirm` text is static, so `roomName` is unused. Keeping the prop would be dead code (YAGNI).

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds. (The component is not yet imported anywhere, so this only verifies the file itself compiles. Next.js still type-checks unreferenced files in the app directory.)

- [ ] **Step 3: Commit**

```bash
git add app/admin/rooms/RoomActions.tsx
git commit -m "feat: add RoomActions component for super-admin room controls"
```

---

## Task 3: Wire `RoomActions` into the rooms table

**Files:**
- Modify: `app/admin/rooms/page.tsx`

- [ ] **Step 1: Import `RoomActions`**

In `app/admin/rooms/page.tsx`, the import block currently ends with:

```ts
import CopyLinkButton from "./CopyLinkButton";
```

Add directly below it:

```ts
import RoomActions from "./RoomActions";
```

- [ ] **Step 2: Add the `Actions` column header**

In the `<thead>` row, the last header cell is currently:

```tsx
              <th style={{ padding: 8 }}>Link</th>
```

Add a new header cell directly after it:

```tsx
              <th style={{ padding: 8 }}>Link</th>
              <th style={{ padding: 8 }}>Actions</th>
```

- [ ] **Step 3: Add the `Actions` cell to each row**

In the `<tbody>` row template, the last cell is currently:

```tsx
                  <td style={{ padding: 8 }}><CopyLinkButton url={url} /></td>
```

Add a new cell directly after it:

```tsx
                  <td style={{ padding: 8 }}><CopyLinkButton url={url} /></td>
                  <td style={{ padding: 8 }}>
                    <RoomActions roomId={r.id} archived={r.archivedAt !== null} />
                  </td>
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add app/admin/rooms/page.tsx
git commit -m "feat: wire RoomActions column into /admin/rooms table"
```

---

## Task 4: Manual verification on the VPS

**Files:** none — verification only.

This feature is UI + a DB-dependent route; verification is a manual walk, consistent with how creator-rooms v1 was verified. Deploy first via the normal recipe (push to `main` triggers auto-deploy, or run the deploy steps in `CLAUDE.md`).

**Do the whole browser walk on `/admin/rooms?archived=all`.** The page defaults to the Active filter (`resolveArchivedFilter` returns `"false"` for no param); on that default view an archived room drops out of the table entirely, so a status change cannot be observed in place. The `all` filter keeps every room visible regardless of status.

- [ ] **Step 1: Archive an active room**

On `/admin/rooms?archived=all`, pick an `ACTIVE` test room, click **Archive**, accept the confirm.
Expected: page reloads, the row's Status flips to `ARCHIVED`, and the Actions cell now shows **Restore** + **Delete**. (The row stays visible because the filter is `all`.)

- [ ] **Step 2: Restore it**

Click **Restore** on that row.
Expected: page reloads, Status flips back to `ACTIVE`, Actions cell shows only **Archive**.

- [ ] **Step 3: Delete-confirm guard — wrong id**

Archive the test room again, click **Delete**, type an incorrect string into the confirm input.
Expected: the **Delete permanently** button stays disabled (greyed, `not-allowed` cursor); no request fires.

- [ ] **Step 4: Delete-confirm — correct id**

Type the exact room id, click **Delete permanently**.
Expected: page reloads, the room is gone from the table. Confirm the audit row:

Run on the VPS: `psql -U mindforum -d mindforum -c "SELECT action, room_id FROM audit_log WHERE action = 'room.hard_delete' ORDER BY at DESC LIMIT 1;"`
Expected: a `room.hard_delete` row for the deleted room id. (The `audit_log` timestamp column is `at`, not `created_at` — see `db/schema.sql`.)

- [ ] **Step 5: Server guard — delete an active room via curl**

Run (substitute an active room id and the admin cookie):
`curl -s -o /dev/null -w "%{http_code}\n" -X DELETE -H "Cookie: <admin cookie>" https://<prod-host>/api/room/<active-room-id>`
Expected: `409`. The room is still present in the table.

- [ ] **Step 6: Server guard — delete a non-existent room via curl**

Run: `curl -s -w "\n%{http_code}\n" -X DELETE -H "Cookie: <admin cookie>" https://<prod-host>/api/room/no-such-room-xyz`
Expected: `404` with body `{"error":"not_found"}`.

---

## Notes for the implementer

- **Inline styles are the codebase convention** for `/admin/*` pages — do not introduce CSS modules or Tailwind.
- **`window.location.reload()` after mutation** is intentional — the table is server-rendered and low-traffic; optimistic UI is explicitly out of scope.
- **No new auth code.** `requireRoomOwner` (archive/restore) and `isAdmin()` (delete) already accept the `ADMIN_TOKEN` cookie via `getActor()` → `cr_super_admin`.
- The archive/restore endpoints already log audit rows and broadcast SSE events — nothing to add there.
