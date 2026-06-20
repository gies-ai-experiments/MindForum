"use client";

import { useEffect, useState } from "react";

type ApiKeyMeta = {
  id: string;
  name: string;
  keyLastFour: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

const NAVY = "#1f2937";

function relTime(ms: number | null): string {
  if (ms === null) return "never";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState("https://your-host");

  useEffect(() => {
    setBase(window.location.origin);
  }, []);

  async function load() {
    const res = await fetch("/api/creator/api-keys");
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys ?? []);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/creator/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "failed");
        return;
      }
      const data = await res.json();
      setRevealed(data.plaintextKey);
      setCopied(false);
      setName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Any script using it stops working immediately.")) return;
    const res = await fetch(`/api/creator/api-keys/${id}`, { method: "DELETE" });
    if (res.ok || res.status === 204) await load();
  }

  function copyRevealed() {
    if (!revealed) return;
    navigator.clipboard.writeText(revealed);
    setCopied(true);
  }

  const codeBox: React.CSSProperties = {
    background: "#0f172a",
    color: "#e2e8f0",
    padding: 12,
    borderRadius: 6,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12.5,
    lineHeight: 1.5,
    overflowX: "auto",
    whiteSpace: "pre",
    margin: 0,
  };

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <h2 style={{ margin: 0 }}>API keys</h2>
      <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
        Create a personal key to make rooms and send invites from scripts — no browser needed.
        The key acts as you; keep it secret.
      </p>

      {/* One-time reveal */}
      {revealed && (
        <div
          role="alert"
          style={{
            border: "2px solid #16a34a",
            background: "#f0fdf4",
            borderRadius: 8,
            padding: 16,
            display: "grid",
            gap: 10,
          }}
        >
          <strong style={{ color: "#166534", fontSize: 15 }}>
            ✓ Here’s your new API key — copy it now
          </strong>
          <span style={{ color: "#15803d", fontSize: 13 }}>
            This is the only time it will be shown. We store only the last 4 characters, so it
            can’t be displayed again. If you lose it, revoke it and make a new one.
          </span>
          <div
            style={{
              background: "white",
              border: "1px solid #bbf7d0",
              borderRadius: 6,
              padding: "10px 12px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              wordBreak: "break-all",
              userSelect: "all",
            }}
          >
            {revealed}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={copyRevealed} style={btn("primary")}>
              {copied ? "✓ Copied" : "Copy key"}
            </button>
            <button type="button" onClick={() => setRevealed(null)} style={btn("muted")}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Create */}
      <form onSubmit={create} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Key name (e.g. CI script)"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          style={{
            flex: "1 1 280px",
            padding: "8px 10px",
            fontSize: 14,
            border: "1px solid #d1d5db",
            borderRadius: 6,
          }}
        />
        <button type="submit" disabled={creating || !name.trim()} style={btn("primary")}>
          {creating ? "Creating…" : "Create key"}
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: "#c00", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      {/* Existing keys */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
          Your keys
        </div>
        {keys.length === 0 ? (
          <p style={{ margin: 0, color: "#9ca3af", fontSize: 14 }}>No keys yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {keys.map((k) => (
              <li
                key={k.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  fontSize: 14,
                  opacity: k.revokedAt ? 0.55 : 1,
                }}
              >
                <span style={{ fontWeight: 600 }}>{k.name}</span>
                <code style={{ color: "#6b7280", fontSize: 13 }}>mf_sk_…{k.keyLastFour}</code>
                <span style={{ color: "#9ca3af", fontSize: 12 }}>used {relTime(k.lastUsedAt)}</span>
                <span style={{ marginLeft: "auto" }}>
                  {k.revokedAt ? (
                    <span style={{ color: "#991b1b", fontSize: 12, fontWeight: 600 }}>revoked</span>
                  ) : (
                    <button type="button" onClick={() => revoke(k.id)} style={btn("danger")}>
                      Revoke
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* How to use */}
      <details style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 14px" }} open>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: NAVY, fontSize: 14 }}>
          How to use your key
        </summary>
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#374151" }}>
              1. Send it as a bearer token on every request:
            </span>
            <pre style={codeBox}>{`Authorization: Bearer mf_sk_YOUR_KEY`}</pre>
          </div>

          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#374151" }}>2. Create a room (you own it):</span>
            <pre style={codeBox}>{`curl -X POST ${base}/api/v1/rooms \\
  -H "Authorization: Bearer mf_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"My room","id":"my-room"}'`}</pre>
          </div>

          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#374151" }}>
              3. Invite people to a room you own:
            </span>
            <pre style={codeBox}>{`curl -X POST ${base}/api/v1/rooms/my-room/invitations \\
  -H "Authorization: Bearer mf_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"invites":[{"inviteeEmail":"a@illinois.edu","inviteeName":"A"}]}'`}</pre>
          </div>

          <p style={{ margin: 0, fontSize: 12.5, color: "#6b7280" }}>
            Limits: 20 rooms/day · ~200 invites/day per key. A revoked key (by you or an admin)
            stops working on the next request.{" "}
            <a
              href="https://github.com/gies-ai-experiments/MindForum/blob/test/docs/programmatic-api.md"
              target="_blank"
              rel="noreferrer"
              style={{ color: NAVY, fontWeight: 600 }}
            >
              Full API reference ↗
            </a>
          </p>
        </div>
      </details>
    </div>
  );
}

function btn(variant: "primary" | "danger" | "muted"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    border: "1px solid",
    borderRadius: 6,
    cursor: "pointer",
  };
  switch (variant) {
    case "primary":
      return { ...base, background: NAVY, color: "white", borderColor: NAVY };
    case "danger":
      return { ...base, background: "white", color: "#991b1b", borderColor: "#fecaca" };
    case "muted":
      return { ...base, background: "white", color: "#6b7280", borderColor: "#d1d5db" };
  }
}
