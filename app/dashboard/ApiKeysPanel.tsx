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

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="api-keys-panel">
      <h2>API keys</h2>
      <p className="muted">
        Use a key as a bearer token to create rooms and send invites from scripts:{" "}
        <code>Authorization: Bearer mf_sk_…</code>
      </p>

      {revealed && (
        <div className="api-key-reveal" role="alert">
          <strong>Copy your new key now — it won’t be shown again:</strong>
          <code>{revealed}</code>
          <button type="button" onClick={() => navigator.clipboard.writeText(revealed)}>
            Copy
          </button>
          <button type="button" onClick={() => setRevealed(null)}>
            Done
          </button>
        </div>
      )}

      <form onSubmit={create} className="api-key-create">
        <input
          type="text"
          placeholder="Key name (e.g. CI script)"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={creating || !name.trim()}>
          {creating ? "Creating…" : "Create key"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <ul className="api-key-list">
        {keys.map((k) => (
          <li key={k.id}>
            <span className="api-key-name">{k.name}</span>{" "}
            <code>…{k.keyLastFour}</code>{" "}
            {k.revokedAt ? (
              <span className="api-key-revoked">revoked</span>
            ) : (
              <button type="button" onClick={() => revoke(k.id)}>
                Revoke
              </button>
            )}
          </li>
        ))}
        {keys.length === 0 && <li className="muted">No keys yet.</li>}
      </ul>
    </div>
  );
}
