"use client";

import { useState } from "react";

type Row = {
  id: string;
  email: string;
  displayName: string;
  disabledAt: number | null;
  tokenLastFour: string;
  tokenRotatedAt: number;
  createdAt: number;
  roomCount: number;
  lastActivityAt: number | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function relTime(ms: number | null): string {
  if (ms === null) return "—";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const days = Math.floor(h / 24);
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${days}d ago`;
}

export default function UsersTable({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reveal, setReveal] = useState<{
    title: string;
    creator: { id: string; email: string; displayName: string };
    plaintextToken: string;
  } | null>(null);

  // ---- create
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function createCreator() {
    setErr(null);
    if (!EMAIL_RE.test(newEmail)) return setErr("Invalid email.");
    if (!newName.trim()) return setErr("Display name required.");
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), displayName: newName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error === "email_taken" ? "Email already on the allowlist." : body.error ?? `HTTP ${res.status}`);
        return;
      }
      setReveal({
        title: "New creator token",
        creator: body.creator,
        plaintextToken: body.plaintextToken,
      });
      setRows((cur) => [
        ...cur,
        {
          id: body.creator.id,
          email: body.creator.email,
          displayName: body.creator.displayName,
          disabledAt: null,
          tokenLastFour: body.creator.tokenLastFour,
          tokenRotatedAt: body.creator.createdAt,
          createdAt: body.creator.createdAt,
          roomCount: 0,
          lastActivityAt: null,
        },
      ]);
      setNewEmail("");
      setNewName("");
      setCreateOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function rotateToken(row: Row) {
    if (
      !window.confirm(
        `Rotate token for ${row.email}? Their existing cookie will stop working immediately.`
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${row.id}/rotate-token`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setReveal({
        title: `New token for ${row.email}`,
        creator: { id: row.id, email: row.email, displayName: row.displayName },
        plaintextToken: body.plaintextToken,
      });
      // Update last-4 optimistically (we don't get it back; recompute from the
      // plaintext for the table row).
      setRows((cur) =>
        cur.map((r) =>
          r.id === row.id
            ? {
                ...r,
                tokenLastFour: body.plaintextToken.slice(-4),
                tokenRotatedAt: Date.now(),
              }
            : r
        )
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleDisabled(row: Row) {
    const wantDisable = row.disabledAt === null;
    setBusyId(row.id);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled: wantDisable }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setRows((cur) =>
        cur.map((r) =>
          r.id === row.id
            ? { ...r, disabledAt: wantDisable ? Date.now() : null }
            : r
        )
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: Row) {
    if (row.roomCount > 0) return;
    if (!window.confirm(`Remove ${row.email} from the allowlist?`)) return;
    setBusyId(row.id);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
      if (res.ok || res.status === 204) {
        setRows((cur) => cur.filter((r) => r.id !== row.id));
      } else {
        const body = await res.json().catch(() => ({}));
        setErr(
          body.error === "owns_rooms"
            ? `Refused: creator still owns ${body.roomCount} room(s).`
            : body.error ?? `HTTP ${res.status}`
        );
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setCreateOpen((o) => !o)}
          style={{
            padding: "8px 16px",
            background: "#1f2937",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {createOpen ? "Cancel" : "+ New creator"}
        </button>
      </div>

      {createOpen && (
        <div
          style={{
            padding: 12,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            marginBottom: 16,
            display: "grid",
            gap: 8,
            maxWidth: 520,
          }}
        >
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="creator@example.edu"
            style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 4 }}
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Display name (e.g. Priya Singh)"
            style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 4 }}
          />
          <button
            type="button"
            onClick={createCreator}
            disabled={creating}
            style={{
              padding: "8px 16px",
              background: creating ? "#9ca3af" : "#1f2937",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: creating ? "wait" : "pointer",
              justifySelf: "start",
            }}
          >
            {creating ? "Creating…" : "Create + reveal token"}
          </button>
        </div>
      )}

      {err && (
        <p role="alert" style={{ color: "#c00", fontSize: 13 }}>
          {err}
        </p>
      )}

      {rows.length === 0 ? (
        <p style={{ color: "#666" }}>No allowlisted creators yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: 8 }}>Display name</th>
              <th style={{ padding: 8 }}>Email</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: "right" }}>Rooms</th>
              <th style={{ padding: 8 }}>Last activity</th>
              <th style={{ padding: 8 }}>Token</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const disabled = r.disabledAt !== null;
              return (
                <tr
                  key={r.id}
                  id={r.id}
                  style={{ borderBottom: "1px solid #f0f0f0" }}
                >
                  <td style={{ padding: 8 }}>
                    {r.displayName}
                    <div style={{ fontSize: 11, color: "#888" }}>{r.id}</div>
                  </td>
                  <td style={{ padding: 8 }}>{r.email}</td>
                  <td style={{ padding: 8 }}>
                    {disabled ? (
                      <span
                        style={{
                          background: "#fee2e2",
                          color: "#991b1b",
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        DISABLED
                      </span>
                    ) : (
                      <span
                        style={{
                          background: "#dcfce7",
                          color: "#166534",
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        ACTIVE
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.roomCount}</td>
                  <td style={{ padding: 8 }}>{relTime(r.lastActivityAt)}</td>
                  <td
                    style={{
                      padding: 8,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 12,
                      color: "#666",
                    }}
                    title={`Rotated ${relTime(r.tokenRotatedAt)}`}
                  >
                    …{r.tokenLastFour}
                  </td>
                  <td style={{ padding: 8, fontSize: 12 }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => rotateToken(r)}
                        disabled={busyId === r.id}
                        style={btn("primary")}
                      >
                        Rotate
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleDisabled(r)}
                        disabled={busyId === r.id}
                        style={btn(disabled ? "ok" : "warn")}
                      >
                        {disabled ? "Enable" : "Disable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        disabled={busyId === r.id || r.roomCount > 0}
                        title={r.roomCount > 0 ? "Transfer rooms first" : undefined}
                        style={btn(r.roomCount > 0 ? "muted" : "danger")}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {reveal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setReveal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              padding: 24,
              borderRadius: 8,
              maxWidth: 560,
              width: "90%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>{reveal.title}</h2>
            <p style={{ color: "#666", fontSize: 13 }}>
              Copy this token now. It will not be shown again — close this dialog
              and we discard it from memory. Send to{" "}
              <strong>{reveal.creator.email}</strong> via your usual channel
              (email, Signal, etc).
            </p>
            <div
              style={{
                background: "#f3f4f6",
                padding: 12,
                borderRadius: 6,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 13,
                wordBreak: "break-all",
                userSelect: "all",
                marginBottom: 12,
              }}
            >
              {reveal.plaintextToken}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(reveal.plaintextToken);
                }}
                style={btn("primary")}
              >
                Copy
              </button>
              <button type="button" onClick={() => setReveal(null)} style={btn("muted")}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function btn(variant: "primary" | "warn" | "danger" | "ok" | "muted"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "4px 10px",
    fontSize: 12,
    border: "1px solid",
    borderRadius: 4,
    cursor: "pointer",
    background: "white",
  };
  switch (variant) {
    case "primary":
      return { ...base, color: "#1f2937", borderColor: "#d1d5db" };
    case "warn":
      return { ...base, color: "#92400e", borderColor: "#fde68a" };
    case "danger":
      return { ...base, color: "#991b1b", borderColor: "#fecaca" };
    case "ok":
      return { ...base, color: "#166534", borderColor: "#bbf7d0" };
    case "muted":
      return { ...base, color: "#9ca3af", borderColor: "#e5e7eb", cursor: "not-allowed" };
  }
}
