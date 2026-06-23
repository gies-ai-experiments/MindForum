"use client";

import { useState } from "react";

export default function SummarizeModal({
  roomId,
  onClose,
}: {
  roomId: string;
  onClose: () => void;
}) {
  const [source, setSource] = useState<"room" | "text">("room");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const body = source === "text" ? { source, text } : { source };
      const res = await fetch(`/api/room/${roomId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onClose();
      } else {
        const map: Record<string, string> = {
          text_required: "Enter some text to summarize.",
          text_too_long: "That text is too long (20,000 character max).",
          bad_source: "Pick what to summarize.",
          room_closed: "This room is closed.",
          llm_error: "Couldn't generate the summary — try again.",
          db_error: "Couldn't save the summary — try again.",
        };
        setErr(map[data.error] ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canGo = !busy && (source === "room" || text.trim().length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 12,
          padding: 24,
          maxWidth: 560,
          width: "92%",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
          fontFamily: "system-ui, sans-serif",
          color: "var(--navy)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontFamily: "Montserrat, sans-serif", fontSize: 20 }}>Summarize</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#6B7280", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 14 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" name="src" checked={source === "room"} onChange={() => setSource("room")} />
            This room&apos;s discussion
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" name="src" checked={source === "text"} onChange={() => setSource("text")} />
            Custom text
          </label>
        </div>

        {source === "text" && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste or type the text to summarize…"
            rows={8}
            style={{ width: "100%", padding: 10, fontSize: 14, border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "inherit", marginBottom: 12 }}
          />
        )}

        {err && <p role="alert" style={{ color: "#c00", fontSize: 13, marginTop: 0 }}>{err}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 14px", fontSize: 14, background: "white", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
          <button
            type="button"
            onClick={generate}
            disabled={!canGo}
            style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, background: canGo ? "var(--orange)" : "#D1D5DB", color: "white", border: "none", borderRadius: 6, cursor: canGo ? "pointer" : "not-allowed" }}
          >
            {busy ? "Summarizing…" : "Generate summary"}
          </button>
        </div>
      </div>
    </div>
  );
}
