"use client";

import { useState } from "react";

const MAX_NAME = 100;
const MAX_PROMPT = 51_200;

export default function GeneralEditor({
  roomId,
  initialName,
  initialSystemPrompt,
  archived,
}: {
  roomId: string;
  initialName: string;
  initialSystemPrompt: string;
  archived: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const dirty = name !== initialName || systemPrompt !== initialSystemPrompt;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/room/${roomId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, systemPrompt }),
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "Saved." });
        // Force a refresh so the header / archive state stays in sync.
        setTimeout(() => window.location.reload(), 400);
      } else {
        const body = await res.json().catch(() => ({}));
        if (res.status === 410) {
          setMsg({ kind: "err", text: "Room is archived — restore first." });
        } else {
          setMsg({ kind: "err", text: body.error ?? `HTTP ${res.status}` });
        }
      }
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 13, color: "#374151" }}>Display name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME}
          disabled={busy || archived}
          style={{
            padding: 8,
            border: "1px solid #d1d5db",
            borderRadius: 6,
          }}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 13, color: "#374151" }}>
          System prompt{" "}
          <span style={{ color: "#888" }}>
            ({systemPrompt.length.toLocaleString()} / {MAX_PROMPT.toLocaleString()} chars)
          </span>
        </span>
        <textarea
          value={systemPrompt}
          onChange={(e) =>
            setSystemPrompt(e.target.value.slice(0, MAX_PROMPT))
          }
          rows={10}
          disabled={busy || archived}
          style={{
            padding: 8,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            resize: "vertical",
          }}
        />
      </label>

      {msg && (
        <p
          role="alert"
          style={{
            margin: 0,
            color: msg.kind === "err" ? "#c00" : "#166534",
            fontSize: 13,
          }}
        >
          {msg.text}
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty || archived}
          style={{
            padding: "8px 16px",
            fontSize: 14,
            background: busy || !dirty || archived ? "#9ca3af" : "#1f2937",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: busy ? "wait" : !dirty || archived ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        {archived && (
          <span style={{ marginLeft: 12, fontSize: 13, color: "#888" }}>
            Archived rooms can't be edited. Restore below.
          </span>
        )}
      </div>
    </div>
  );
}
