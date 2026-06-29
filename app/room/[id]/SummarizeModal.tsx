"use client";

import { useEffect, useState } from "react";

type ExportTarget = { id: string; name: string };

export default function SummarizeModal({
  roomId,
  roomName,
  onClose,
}: {
  roomId: string;
  roomName: string;
  onClose: () => void;
}) {
  const [source, setSource] = useState<"room" | "text">("room");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [targets, setTargets] = useState<ExportTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetRoomId, setTargetRoomId] = useState("");
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState(() => `Meeting summary from ${roomName}`.slice(0, 80));
  const [exported, setExported] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTargetsLoading(true);
    fetch(`/api/room/${roomId}/summary/export-targets`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        return Array.isArray(data.targets) ? (data.targets as ExportTarget[]) : [];
      })
      .then((nextTargets) => {
        if (cancelled) return;
        setTargets(nextTargets);
        setTargetRoomId((prev) => prev || nextTargets.find((target) => target.id === roomId)?.id || nextTargets[0]?.id || "");
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Couldn't load export targets.");
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  async function generate() {
    setBusy(true);
    setErr(null);
    setExported(null);
    try {
      const body = source === "text" ? { source, text, post: false } : { source, post: false };
      const res = await fetch(`/api/room/${roomId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSummary(typeof data.summary === "string" ? data.summary : "");
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

  async function exportSummary() {
    if (!summary.trim() || !targetRoomId) return;
    setExporting(true);
    setErr(null);
    setExported(null);
    try {
      const res = await fetch(`/api/room/${roomId}/summary/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationRoomId: targetRoomId, title, summary }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map: Record<string, string> = {
          destination_required: "Choose a room to export into.",
          summary_required: "Generate a summary before exporting.",
          summary_too_long: "That summary is too long to attach as context.",
          destination_not_joined: "You haven't joined that destination room.",
          room_closed: "That destination room is closed.",
          archived: "That room is archived.",
          not_found: "That room couldn't be found.",
        };
        setErr(map[data.error] ?? `HTTP ${res.status}`);
        return;
      }
      const targetName = targets.find((target) => target.id === targetRoomId)?.name ?? targetRoomId;
      setExported(`Exported to ${targetName}.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const canGo = !busy && (source === "room" || text.trim().length > 0);
  const canExport = !exporting && !!summary.trim() && !!targetRoomId && !!title.trim();

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

        {summary && (
          <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
              Context title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                placeholder="Meeting summary title"
                style={{ width: "100%", padding: 10, fontSize: 14, border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "inherit" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
              Export into room
              <select
                value={targetRoomId}
                onChange={(e) => setTargetRoomId(e.target.value)}
                disabled={targetsLoading || targets.length === 0}
                style={{ width: "100%", padding: 10, fontSize: 14, border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "inherit", background: "white" }}
              >
                {targetsLoading ? (
                  <option value="">Loading rooms…</option>
                ) : targets.length === 0 ? (
                  <option value="">No eligible rooms</option>
                ) : (
                  targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name} ({target.id})
                    </option>
                  ))
                )}
              </select>
            </label>
            <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 12, background: "#F9FAFB", maxHeight: 220, overflowY: "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Summary preview
              </div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.45, color: "var(--text)" }}>{summary}</pre>
            </div>
          </div>
        )}

        {err && <p role="alert" style={{ color: "#c00", fontSize: 13, marginTop: 0 }}>{err}</p>}
        {exported && <p role="status" style={{ color: "#166534", fontSize: 13, marginTop: 0 }}>{exported}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 14px", fontSize: 14, background: "white", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
          {summary && (
            <button
              type="button"
              onClick={exportSummary}
              disabled={!canExport}
              style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, background: canExport ? "var(--navy)" : "#D1D5DB", color: "white", border: "none", borderRadius: 6, cursor: canExport ? "pointer" : "not-allowed" }}
            >
              {exporting ? "Exporting…" : "Export as context"}
            </button>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={!canGo}
            style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, background: canGo ? "var(--orange)" : "#D1D5DB", color: "white", border: "none", borderRadius: 6, cursor: canGo ? "pointer" : "not-allowed" }}
          >
            {busy ? "Summarizing…" : summary ? "Regenerate summary" : "Generate summary"}
          </button>
        </div>
      </div>
    </div>
  );
}
