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

export default function UserApiKeys({ creatorId }: { creatorId: string }) {
  const [keys, setKeys] = useState<ApiKeyMeta[] | null>(null);

  async function load() {
    const res = await fetch(`/api/admin/users/${creatorId}/api-keys`);
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys ?? []);
    } else {
      setKeys([]);
    }
  }
  useEffect(() => {
    load();
  }, [creatorId]);

  async function revoke(keyId: string) {
    if (!confirm("Revoke this user's key? It stops working immediately.")) return;
    const res = await fetch(`/api/admin/users/${creatorId}/api-keys/${keyId}`, {
      method: "DELETE",
    });
    if (res.ok || res.status === 204) await load();
  }

  if (keys === null) return <p className="muted">Loading keys…</p>;
  if (keys.length === 0) return <p className="muted">No API keys.</p>;

  return (
    <ul className="admin-api-key-list">
      {keys.map((k) => (
        <li key={k.id}>
          <span>{k.name}</span> <code>…{k.keyLastFour}</code>{" "}
          {k.revokedAt ? (
            <span className="api-key-revoked">revoked</span>
          ) : (
            <button type="button" onClick={() => revoke(k.id)}>
              Revoke
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
