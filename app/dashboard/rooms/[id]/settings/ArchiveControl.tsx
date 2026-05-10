"use client";

import { useState } from "react";

export default function ArchiveControl({
  roomId,
  archived,
}: {
  roomId: string;
  archived: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const action = archived ? "restore" : "archive";
    if (!archived) {
      const ok = window.confirm(
        "Archive this room? Participants will no longer be able to post or join. You can restore it later."
      );
      if (!ok) return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/room/${roomId}/${action}`, {
        method: "POST",
      });
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

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        style={{
          padding: "8px 16px",
          fontSize: 14,
          background: archived ? "#166534" : "white",
          color: archived ? "white" : "#991b1b",
          border: archived ? "none" : "1px solid #fecaca",
          borderRadius: 6,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "…" : archived ? "Restore room" : "Archive room"}
      </button>
      {err && (
        <p style={{ margin: "8px 0 0", color: "#c00", fontSize: 13 }}>{err}</p>
      )}
    </div>
  );
}
