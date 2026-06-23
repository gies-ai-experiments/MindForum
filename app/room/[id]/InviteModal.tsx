"use client";

import { useState } from "react";
import InvitationsPanel from "@/app/dashboard/rooms/[id]/settings/InvitationsPanel";

/**
 * In-room invite panel for the room owner / super-admin. Two options:
 * (1) Copy link — share the room URL (anyone with it can join), and
 * (2) Invite by name/email — reuses the dashboard InvitationsPanel, which
 *     posts to /api/admin/rooms/[id]/invitations (owner-gated, ACS email).
 */
export default function InviteModal({
  roomId,
  archived,
  onClose,
}: {
  roomId: string;
  archived: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    const url =
      typeof window !== "undefined" ? window.location.href : `/room/${roomId}`;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => window.prompt("Copy this room link:", url));
    } else {
      window.prompt("Copy this room link:", url);
    }
  }

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontFamily: "Montserrat, sans-serif", fontSize: 20 }}>
            Invite to this room
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#6B7280", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <p style={{ marginTop: 0, fontSize: 14, color: "#444" }}>
          Share the link, or invite someone by name and email — they&apos;ll get an
          email and the invitation waits on their dashboard.
        </p>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#13294B" }}>
            Copy link
          </div>
          <button
            type="button"
            onClick={copyLink}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 600,
              background: copied ? "#166534" : "var(--orange)",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {copied ? "Link copied ✓" : "Copy room link"}
          </button>
        </div>

        <div style={{ borderTop: "1px solid #eee", paddingTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#13294B" }}>
            Invite by name / email
          </div>
          <InvitationsPanel roomId={roomId} archived={archived} />
        </div>
      </div>
    </div>
  );
}
