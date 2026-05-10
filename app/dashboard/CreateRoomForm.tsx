"use client";

import { useState } from "react";

const SLUG_RE = /^[a-z0-9-]{3,40}$/;

export default function CreateRoomForm() {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugValid = SLUG_RE.test(slug);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!slugValid) {
      setError("Slug must be 3–40 characters, lowercase letters / digits / hyphens.");
      return;
    }
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: slug, name: name.trim(), systemPrompt }),
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = `/dashboard/rooms/${data.id}/settings`;
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.error === "slug_taken") {
        const owner = body.ownerDisplayName ?? "another creator";
        setError(`That slug is taken by ${owner} — try another.`);
      } else if (res.status === 400 && body.error === "invalid_slug") {
        setError(
          body.hint ?? "Invalid slug format."
        );
      } else if (res.status === 401) {
        setError("Your session expired. Reload the page to sign in again.");
      } else if (res.status === 429) {
        setError(
          `Rate limited — try again in ${body.retryAfterSeconds ?? 60}s.`
        );
      } else {
        setError(body.error ?? `Server error (HTTP ${res.status}).`);
      }
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 8, maxWidth: 720 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 13, color: "#374151" }}>
          Slug{" "}
          <span style={{ color: "#888" }}>
            (lowercase letters, digits, hyphens; 3–40 chars)
          </span>
        </span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="my-room"
          required
          style={{
            padding: 8,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            border: "1px solid #d1d5db",
            borderRadius: 6,
          }}
        />
        {slug && !slugValid && (
          <span style={{ fontSize: 12, color: "#c00" }}>
            Slug must match {SLUG_RE.toString()}
          </span>
        )}
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 13, color: "#374151" }}>Display name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My team's brainstorming room"
          required
          maxLength={100}
          style={{
            padding: 8,
            border: "1px solid #d1d5db",
            borderRadius: 6,
          }}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 13, color: "#374151" }}>
          System prompt{" "}
          <span style={{ color: "#888" }}>(optional, ≤50 KB)</span>
        </span>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          placeholder="You are a facilitator for…"
          style={{
            padding: 8,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            resize: "vertical",
          }}
        />
      </label>

      {error && (
        <p role="alert" style={{ color: "#c00", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !slugValid || !name.trim()}
        style={{
          padding: "10px 20px",
          fontSize: 14,
          background: busy ? "#9ca3af" : "#1f2937",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: busy ? "wait" : "pointer",
          justifySelf: "start",
        }}
      >
        {busy ? "Creating…" : "Create room"}
      </button>
    </form>
  );
}
