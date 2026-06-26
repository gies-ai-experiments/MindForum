"use client";

import { useState } from "react";

export default function WebSearchToggle({
  roomId,
  initialEnabled,
  archived,
}: {
  roomId: string;
  initialEnabled: boolean;
  archived: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/room/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webSearchEnabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEnabled(data.webSearchEnabled ?? next);
      } else {
        setErr(
          res.status === 410
            ? "Room is archived — restore it first."
            : data.error ?? `HTTP ${res.status}`
        );
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: archived ? "default" : "pointer" }}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={busy || archived}
          style={{
            position: "relative",
            width: 42,
            height: 24,
            borderRadius: 999,
            border: "none",
            background: enabled ? "#166534" : "#9CA3AF",
            cursor: busy || archived ? "not-allowed" : "pointer",
            opacity: archived ? 0.5 : 1,
            transition: "background 0.15s",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: enabled ? 20 : 2,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "white",
              transition: "left 0.15s",
            }}
          />
        </button>
        <span style={{ fontSize: 14 }}>
          Web search is <strong>{enabled ? "on" : "off"}</strong>
        </span>
      </label>
      <p style={{ margin: "8px 0 0", fontSize: 13, color: "#666" }}>
        When on, the AI may search the web — but only when a participant
        explicitly asks it to look something up — and cites its sources. Web
        searches incur a per-search cost. Off by default.
      </p>
      {err && (
        <p role="alert" style={{ margin: "8px 0 0", color: "#c00", fontSize: 13 }}>
          {err}
        </p>
      )}
    </div>
  );
}
