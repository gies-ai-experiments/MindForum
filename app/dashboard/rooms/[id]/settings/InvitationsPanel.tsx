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

function statusPill(status: string) {
  const colors: Record<string, { bg: string; fg: string }> = {
    pending: { bg: "#F3F4F6", fg: "#6B7280" },
    accepted: { bg: "#DCFCE7", fg: "#166534" },
    declined: { bg: "#FEE2E2", fg: "#991B1B" },
  };
  const c = colors[status] ?? colors.pending;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.03em",
        background: c.bg,
        color: c.fg,
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/admin/rooms/${roomId}/invitations`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setInvitations)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [roomId]);

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
        const res = await fetch(
          `/api/dashboard/creators/lookup?q=${encodeURIComponent(value.trim())}`
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
        }
      } catch {
        /* ignore */
      }
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
        body: JSON.stringify({
          inviteeEmail: email.trim(),
          inviteeName: name.trim(),
        }),
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
      const res = await fetch(
        `/api/admin/rooms/${roomId}/invitations/${invId}`,
        { method: "DELETE" }
      );
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

  if (!loaded) {
    return <p style={{ color: "#666", fontSize: 13 }}>Loading…</p>;
  }

  return (
    <div>
      {err && (
        <p role="alert" style={{ color: "#c00", fontSize: 13, marginTop: 0 }}>
          {err}
        </p>
      )}

      {!archived && (
        <div style={{ marginBottom: 20, position: "relative" }}>
          <form
            onSubmit={sendInvite}
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: "1 1 200px", position: "relative" }}>
              <input
                type="email"
                placeholder="Email or name"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                onFocus={() =>
                  suggestions.length > 0 && setShowSuggestions(true)
                }
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                disabled={busy}
                autoComplete="off"
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: 14,
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  boxSizing: "border-box",
                }}
              />
              {showSuggestions && suggestions.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    zIndex: 10,
                    maxHeight: 200,
                    overflowY: "auto",
                  }}
                >
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={() => selectSuggestion(s)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 10px",
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{s.displayName}</span>
                      <span style={{ color: "#888", marginLeft: 8 }}>
                        {s.email}
                      </span>
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
              style={{
                flex: "1 1 150px",
                padding: "6px 10px",
                fontSize: 14,
                border: "1px solid #d1d5db",
                borderRadius: 6,
              }}
            />
            <button
              type="submit"
              disabled={busy || !email.trim() || !name.trim()}
              style={{
                padding: "6px 16px",
                fontSize: 13,
                fontWeight: 600,
                background: busy ? "#D1D5DB" : "var(--orange)",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Sending…" : "Send Invite"}
            </button>
          </form>
        </div>
      )}

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
                <td style={{ padding: 6, fontSize: 13, color: "#666" }}>
                  {inv.inviteeEmail}
                </td>
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
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        background: "white",
                        color: "#991b1b",
                        border: "1px solid #fecaca",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
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
