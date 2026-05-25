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
