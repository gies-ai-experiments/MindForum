"use client";

import { useState } from "react";

type Row = {
  id: string;
  name: string;
  email: string;
  joinedAt: number;
};

export default function ParticipantsPanel({
  roomId,
  participants: initial,
  archived,
}: {
  roomId: string;
  participants: Row[];
  archived: boolean;
}) {
  const [people, setPeople] = useState(initial);
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
      const res = await fetch(
        `/api/room/${roomId}/participants/${pid}`,
        { method: "DELETE" }
      );
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

  if (people.length === 0) {
    return (
      <p style={{ color: "#666", fontSize: 13 }}>
        No participants yet.
      </p>
    );
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
            <th style={{ padding: 6, fontSize: 13 }}>Joined</th>
            <th style={{ padding: 6, fontSize: 13 }}></th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td style={{ padding: 6, fontSize: 14 }}>{p.name}</td>
              <td style={{ padding: 6, fontSize: 13, color: "#666" }}>
                {p.email}
              </td>
              <td style={{ padding: 6, fontSize: 13, color: "#666" }}>
                {new Date(p.joinedAt).toISOString().slice(0, 10)}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
