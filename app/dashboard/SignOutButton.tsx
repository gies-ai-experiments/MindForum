"use client";

import { useState } from "react";

export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/creator/session", { method: "DELETE" });
        } finally {
          // Hard reload — clears any client cache and lets middleware re-evaluate.
          window.location.href = "/dashboard";
        }
      }}
      style={{
        padding: "6px 12px",
        fontSize: 13,
        background: "white",
        color: "#374151",
        border: "1px solid #d1d5db",
        borderRadius: 6,
        cursor: busy ? "wait" : "pointer",
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
