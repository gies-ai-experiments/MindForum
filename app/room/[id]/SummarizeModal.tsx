"use client";

import { useEffect, useState } from "react";
import { slugify, isValidRoomSlug } from "@/lib/slugify";

type ExportTarget = { id: string; name: string };

export default function SummarizeModal({
  roomId,
  roomName,
  canCreateRoom = false,
  onClose,
}: {
  roomId: string;
  roomName: string;
  // When true (the manager "Export context" entry), the user may export into a
  // brand-new room they'll own — not just an existing one. Defaults off so the
  // plain /summarize entry keeps its existing-room-only behavior.
  canCreateRoom?: boolean;
  onClose: () => void;
}) {
  const [source, setSource] = useState<"room" | "text">("room");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [targets, setTargets] = useState<ExportTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetRoomId, setTargetRoomId] = useState("");
  const [destKind, setDestKind] = useState<"existing" | "new">("existing");
  const [newRoomName, setNewRoomName] = useState("");
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState(() => `Meeting summary from ${roomName}`.slice(0, 80));
  const [exported, setExported] = useState<string | null>(null);
  const [exportedRoomId, setExportedRoomId] = useState<string | null>(null);
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
    setExportedRoomId(null);
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

  const newSlug = slugify(newRoomName);

  async function exportSummary() {
    if (!summary.trim() || !title.trim()) return;
    setExporting(true);
    setErr(null);
    setExported(null);
    setExportedRoomId(null);
    try {
      if (destKind === "new") {
        if (!isValidRoomSlug(newSlug)) {
          setErr("Enter a room name (3–40 letters, digits, or hyphens once converted).");
          return;
        }
        const res = await fetch(`/api/room/${roomId}/summary/export/new-room`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: newSlug, name: newRoomName.trim(), title, summary }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const map: Record<string, string> = {
            invalid_slug: "That room URL isn't valid — try a different name.",
            slug_taken: data.ownerDisplayName
              ? `That room URL is already taken (owned by ${data.ownerDisplayName}). Try another name.`
              : "That room URL is already taken. Try another name.",
            summary_required: "Generate a summary before exporting.",
            summary_too_long: "That summary is too long to attach as context.",
            unauthorized: "Only room managers can create a room from here.",
            not_found: "Only room managers can create a room from here.",
            db_error: "Couldn't create the room — try again.",
          };
          setErr(map[data.error] ?? (res.status === 429 ? "You've hit the daily room-creation limit." : `HTTP ${res.status}`));
          return;
        }
        setExported(`Created “${newRoomName.trim()}” with the summary as its context.`);
        setExportedRoomId(typeof data.roomId === "string" ? data.roomId : null);
        return;
      }

      if (!targetRoomId) return;
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
      setExportedRoomId(targetRoomId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const canGo = !busy && (source === "room" || text.trim().length > 0);
  const canExport =
    !exporting &&
    !!summary.trim() &&
    !!title.trim() &&
    (destKind === "existing" ? !!targetRoomId : isValidRoomSlug(newSlug));

  const fieldStyle = { width: "100%", padding: 10, fontSize: 14, border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "inherit" } as const;

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
          <h2 style={{ margin: 0, fontFamily: "Montserrat, sans-serif", fontSize: 20 }}>
            {canCreateRoom ? "Export context" : "Summarize"}
          </h2>
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
            style={{ ...fieldStyle, marginBottom: 12 }}
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
                style={fieldStyle}
              />
            </label>

            {canCreateRoom && (
              <div style={{ display: "flex", gap: 16, fontSize: 14 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="radio" name="dest" checked={destKind === "existing"} onChange={() => setDestKind("existing")} />
                  An existing room
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="radio" name="dest" checked={destKind === "new"} onChange={() => setDestKind("new")} />
                  A new room
                </label>
              </div>
            )}

            {destKind === "existing" ? (
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
                Export into room
                <select
                  value={targetRoomId}
                  onChange={(e) => setTargetRoomId(e.target.value)}
                  disabled={targetsLoading || targets.length === 0}
                  style={{ ...fieldStyle, background: "white" }}
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
            ) : (
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
                New room name
                <input
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="e.g. Q3 Onboarding Revamp"
                  style={fieldStyle}
                />
                <span style={{ fontWeight: 400, fontSize: 12, color: "#6B7280" }}>
                  {newSlug ? <>URL: <code>/room/{newSlug}</code> · you&apos;ll own this room</> : "Enter a name (3–40 letters, digits, or hyphens)."}
                </span>
              </label>
            )}

            <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 12, background: "#F9FAFB", maxHeight: 220, overflowY: "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Summary preview
              </div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.45, color: "var(--text)" }}>{summary}</pre>
            </div>
          </div>
        )}

        {err && <p role="alert" style={{ color: "#c00", fontSize: 13, marginTop: 0 }}>{err}</p>}
        {exported && (
          <p role="status" style={{ color: "#166534", fontSize: 13, marginTop: 0 }}>
            {exported}
            {exportedRoomId && (
              <>
                {" "}
                <a href={`/room/${exportedRoomId}`} style={{ color: "var(--navy)", fontWeight: 700 }}>Open the room →</a>
              </>
            )}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 14px", fontSize: 14, background: "white", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
          {summary && (
            <button
              type="button"
              onClick={exportSummary}
              disabled={!canExport}
              style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, background: canExport ? "var(--navy)" : "#D1D5DB", color: "white", border: "none", borderRadius: 6, cursor: canExport ? "pointer" : "not-allowed" }}
            >
              {exporting ? "Exporting…" : destKind === "new" ? "Create room with context" : "Export as context"}
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
