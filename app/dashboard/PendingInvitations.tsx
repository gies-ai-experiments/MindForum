"use client";

import { useState, useEffect } from "react";

type Invitation = {
  id: string;
  roomId: string;
  roomName: string;
  inviterName: string;
  inviteeName: string;
  createdAt: number;
};

export default function PendingInvitations() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/invitations")
      .then((res) => (res.ok ? res.json() : []))
      .then(setInvitations)
      .catch(() => {});
  }, []);

  async function respond(invId: string, action: "accept" | "decline") {
    setBusyId(invId);
    setErr(null);
    try {
      const res = await fetch(`/api/dashboard/invitations/${invId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setInvitations((cur) => cur.filter((i) => i.id !== invId));
        if (action === "accept") {
          window.location.reload();
        }
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

  if (invitations.length === 0) {
    return null;
  }

  return (
    <div className="dash-panel" id="invitations">
      <div className="dash-panel__head">
        <span className="dash-panel__title">
          Pending invitations
          <span>from other room owners</span>
        </span>
      </div>
      <div className="dash-panel__body">
        {err && (
          <p role="alert" style={{ color: "#c00", fontSize: 13 }}>
            {err}
          </p>
        )}
        <table className="dash-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>From</th>
              <th>Sent</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <a
                    className="dash-roomname"
                    href={`/dashboard/rooms/${inv.roomId}/settings`}
                  >
                    {inv.roomName}
                  </a>
                </td>
                <td style={{ fontSize: 13, color: "#666" }}>
                  {inv.inviterName}
                </td>
                <td style={{ fontSize: 13, color: "#666" }}>
                  {new Date(inv.createdAt).toISOString().slice(0, 10)}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => respond(inv.id, "accept")}
                    disabled={busyId === inv.id}
                    style={{
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      background: busyId === inv.id ? "#86EFAC" : "#22C55E",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      cursor: busyId === inv.id ? "not-allowed" : "pointer",
                      marginRight: 6,
                    }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(inv.id, "decline")}
                    disabled={busyId === inv.id}
                    style={{
                      padding: "4px 12px",
                      fontSize: 12,
                      background: "white",
                      color: "#991b1b",
                      border: "1px solid #fecaca",
                      borderRadius: 4,
                      cursor: busyId === inv.id ? "not-allowed" : "pointer",
                    }}
                  >
                    Decline
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
