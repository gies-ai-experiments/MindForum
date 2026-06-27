"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_SYSTEM_PROMPT_CHARS } from "@/lib/limits";
import GeneratePromptButton from "@/app/components/GeneratePromptButton";

const ADMIN_TOKEN_KEY = "mindforum_admin_token";

/**
 * Admin quick-create card. Existing admin links rely on `/?token=...` to
 * bootstrap the token into localStorage, so the pickup logic must live on
 * the landing page. The card itself only renders once a token is cached —
 * anonymous visitors never see a create form that would 401.
 */
export default function AdminCreateCard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const promptTooLong = systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS;

  // Pick up ?token=... on mount, cache in localStorage, strip from URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("token");
    if (fromUrl) {
      window.localStorage.setItem(ADMIN_TOKEN_KEY, fromUrl);
      setAdminToken(fromUrl);
      params.delete("token");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      return;
    }
    setAdminToken(window.localStorage.getItem(ADMIN_TOKEN_KEY));
  }, []);

  // No token and nothing to report: render nothing for anonymous visitors.
  // After a 401 the token is cleared but `err` is set — keep the card so the
  // "creation is restricted" message is visible instead of silently vanishing.
  if (!adminToken && !err) return null;
  if (!adminToken) {
    return (
      <section className="landing-card landing-admin-create">
        <h2>Create a room (admin)</h2>
        <p style={{ color: "crimson", margin: 0 }}>{err}</p>
      </section>
    );
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": adminToken!,
        },
        body: JSON.stringify({
          name: name || "Untitled Room",
          systemPrompt: systemPrompt.trim(),
        }),
      });
      if (res.status === 401) {
        window.localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken(null);
        throw new Error("unauthorized");
      }
      if (!res.ok) throw new Error("create_failed");
      const { id } = await res.json();
      router.push(`/room/${id}`);
    } catch (e) {
      setErr(
        e instanceof Error && e.message === "unauthorized"
          ? "Room creation is restricted. Ask the admin for an access link."
          : "Could not create room."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="landing-card landing-admin-create">
      <h2>Create a room (admin)</h2>
      <form onSubmit={onCreate} style={{ display: "grid", gap: 10 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Room name (e.g., Fall 2026 Grant Brainstorm)"
        />
        <div>
          <label className="landing-admin-create__label">
            <span>AI guidance (optional) — how should the AI behave in this room?</span>
            <span
              style={{
                color: promptTooLong ? "#c00" : "var(--muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {systemPrompt.length.toLocaleString()} / {MAX_SYSTEM_PROMPT_CHARS.toLocaleString()}
            </span>
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="e.g., You are helping four faculty shape a grant proposal. Ask probing questions before suggesting answers. Prefer plain language over jargon."
            rows={4}
            style={{ borderColor: promptTooLong ? "#c00" : undefined }}
          />
          {promptTooLong && (
            <p style={{ color: "#c00", fontSize: 12, margin: "4px 0 0" }}>
              System prompt is {(systemPrompt.length - MAX_SYSTEM_PROMPT_CHARS).toLocaleString()} characters over the {MAX_SYSTEM_PROMPT_CHARS.toLocaleString()}-char limit. Keep it lean — put reference material in uploaded room files instead.
            </p>
          )}
          <GeneratePromptButton
            value={systemPrompt}
            onAccept={setSystemPrompt}
            disabled={loading}
            adminToken={adminToken}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={loading || promptTooLong}
            className="landing-btn landing-btn--orange"
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
      {err && <p style={{ color: "crimson", marginBottom: 0 }}>{err}</p>}
    </section>
  );
}
