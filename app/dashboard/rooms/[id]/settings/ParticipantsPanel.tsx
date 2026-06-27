"use client";

import { useState } from "react";

type Row = {
  id: string;
  name: string;
  email: string;
  joinedAt: number;
  presence: { color: "green" | "yellow" | "none"; label: string };
};

export default function ParticipantsPanel({
  roomId,
  participants: initial,
  archived,
  coAdminEmails: initialCoAdmins,
  ownerEmail,
  canManageCoAdmins,
}: {
  roomId: string;
  participants: Row[];
  archived: boolean;
  coAdminEmails: string[];
  ownerEmail: string;
  canManageCoAdmins: boolean;
}) {
  const [people, setPeople] = useState(initial);
  const [coAdmins, setCoAdmins] = useState<string[]>(
    initialCoAdmins.map((e) => e.toLowerCase()),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function kick(pid: string, name: string) {
    if (
      !window.confirm(
        `Remove ${name}? They keep their messages in the conversation but lose access. v1 has no rejoin block — they can come back if they have the link.`
      )
    ) {
      return;
    }
    setBusyId(pid);
    setErr(null);
    try {
      const res = await fetch(`/api/room/${roomId}/participants/${pid}`, { method: "DELETE" });
      if (res.ok || res.status === 204) {
        setPeople((cur) => cur.filter((p) => p.id !== pid));
      } else if (res.status === 410) {
        setErr("Room is archived — restore first.");
      } else {
        const body = await res.json().catch(() => ({}));
        setErr(body.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleCoAdmin(p: Row, isCo: boolean) {
    setBusyId(p.id);
    setErr(null);
    try {
      if (isCo) {
        const list = await fetch(`/api/admin/rooms/${roomId}/co-admins`).then((r) =>
          r.ok ? r.json() : [],
        );
        const match = (list as { creatorId: string; email: string }[]).find(
          (x) => x.email.toLowerCase() === p.email.toLowerCase(),
        );
        if (match) {
          const res = await fetch(`/api/admin/rooms/${roomId}/co-admins/${match.creatorId}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        }
        setCoAdmins((c) => c.filter((e) => e !== p.email.toLowerCase()));
      } else {
        const res = await fetch(`/api/admin/rooms/${roomId}/co-admins`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: p.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setCoAdmins((c) => [...c, p.email.toLowerCase()]);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (people.length === 0) {
    return <p style={{ color: "#666", fontSize: 13 }}>No participants yet.</p>;
  }

  return (
    <div>
      {err && (
        <p role="alert" style={{ color: "#c00", fontSize: 13, marginTop: 0 }}>
          {err}
        </p>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
            <th style={{ padding: 6, fontSize: 13 }}>Name</th>
            <th style={{ padding: 6, fontSize: 13 }}>Email</th>
            <th style={{ padding: 6, fontSize: 13 }}>Role</th>
            <th style={{ padding: 6, fontSize: 13 }}>Joined</th>
            <th style={{ padding: 6, fontSize: 13 }}>Status</th>
            <th style={{ padding: 6, fontSize: 13 }}></th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const isOwnerRow = p.email.toLowerCase() === ownerEmail;
            const isCo = coAdmins.includes(p.email.toLowerCase());
            return (
              <tr key={p.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td style={{ padding: 6, fontSize: 14 }}>{p.name}</td>
                <td style={{ padding: 6, fontSize: 13, color: "#666" }}>{p.email}</td>
                <td style={{ padding: 6, fontSize: 12 }}>
                  {isOwnerRow ? (
                    <strong style={{ color: "#13294B" }}>Owner</strong>
                  ) : isCo ? (
                    <span style={{ color: "#166534", fontWeight: 600 }}>Co-admin</span>
                  ) : (
                    <span style={{ color: "#6B7280" }}>Participant</span>
                  )}
                  {canManageCoAdmins && !isOwnerRow && (
                    <button
                      type="button"
                      onClick={() => toggleCoAdmin(p, isCo)}
                      disabled={busyId === p.id || archived}
                      style={{
                        marginLeft: 8,
                        padding: "2px 8px",
                        fontSize: 11,
                        background: "white",
                        border: "1px solid #d1d5db",
                        borderRadius: 4,
                        cursor: busyId === p.id || archived ? "not-allowed" : "pointer",
                      }}
                    >
                      {isCo ? "Remove co-admin" : "Make co-admin"}
                    </button>
                  )}
                </td>
                <td style={{ padding: 6, fontSize: 13, color: "#666" }}>
                  {new Date(p.joinedAt).toISOString().slice(0, 10)}
                </td>
                <td style={{ padding: 6, fontSize: 13, color: "#666" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 8,
                        background:
                          p.presence.color === "green"
                            ? "#22c55e"
                            : p.presence.color === "yellow"
                              ? "#f59e0b"
                              : "transparent",
                        border: p.presence.color === "none" ? "1px solid #d1d5db" : "none",
                      }}
                    />
                    {p.presence.label}
                  </span>
                </td>
                <td style={{ padding: 6, fontSize: 13, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => kick(p.id, p.name)}
                    disabled={busyId === p.id || archived}
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      background: "white",
                      color: archived ? "#9ca3af" : "#991b1b",
                      border: "1px solid",
                      borderColor: archived ? "#e5e7eb" : "#fecaca",
                      borderRadius: 4,
                      cursor: archived ? "not-allowed" : "pointer",
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
