"use client";

import { useState } from "react";
import { MAX_SYSTEM_PROMPT_CHARS } from "@/lib/limits";
import DashboardAttachButton, {
  type PendingAttachment,
} from "./DashboardAttachButton";
import InviteeAutocomplete from "./InviteeAutocomplete";

const SLUG_RE = /^[a-z0-9-]{3,40}$/;

function pendingLabel(item: PendingAttachment): string {
  if (item.kind === "file") return item.file.name;
  if (item.kind === "github") return `GitHub: ${item.url}`;
  return `URL: ${item.url}`;
}

export default function CreateRoomForm() {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [pendingInvites, setPendingInvites] = useState<
    { email: string; name: string }[]
  >([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addInvite() {
    const email = inviteEmail.trim();
    const name = inviteName.trim();
    if (!email.includes("@") || !name) return;
    if (
      pendingInvites.some((p) => p.email.toLowerCase() === email.toLowerCase())
    )
      return;
    setPendingInvites((p) => [...p, { email, name }]);
    setInviteEmail("");
    setInviteName("");
  }

  const slugValid = SLUG_RE.test(slug);
  const promptTooLong = systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS;

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
    if (promptTooLong) {
      setError(
        `System prompt is ${(systemPrompt.length - MAX_SYSTEM_PROMPT_CHARS).toLocaleString()} characters over the ${MAX_SYSTEM_PROMPT_CHARS.toLocaleString()}-char limit.`
      );
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
        // The room exists now — apply queued attachments against its id.
        const failures: string[] = [];
        for (const item of pending) {
          try {
            let r: Response;
            if (item.kind === "file") {
              const fd = new FormData();
              fd.append("file", item.file);
              r = await fetch(`/api/dashboard/room/${data.id}/upload`, {
                method: "POST",
                body: fd,
              });
            } else if (item.kind === "github") {
              r = await fetch(
                `/api/dashboard/room/${data.id}/context/github`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    url: item.url,
                    include: item.include,
                    exclude: item.exclude,
                  }),
                }
              );
            } else {
              r = await fetch(`/api/dashboard/room/${data.id}/context/url`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  url: item.url,
                  instruction: item.instruction,
                }),
              });
            }
            if (!r.ok) {
              const b = await r.json().catch(() => ({}));
              failures.push(`${pendingLabel(item)} — ${b.error ?? r.status}`);
            }
          } catch (err) {
            failures.push(`${pendingLabel(item)} — ${(err as Error).message}`);
          }
        }
        if (failures.length > 0) {
          alert(
            `Room created, but some attachments failed:\n${failures.join("\n")}`
          );
        }
        // Fire the queued invites in one fast call (server sends emails in the
        // background). Non-fatal: the room exists; the creator can finish
        // inviting from the settings panel if this request fails.
        if (pendingInvites.length > 0) {
          try {
            await fetch(`/api/admin/rooms/${data.id}/invitations`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                invites: pendingInvites.map((p) => ({
                  inviteeEmail: p.email,
                  inviteeName: p.name,
                })),
              }),
            });
          } catch {
            /* non-fatal */
          }
        }
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

      <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
        <span style={{ fontSize: 13, color: "#374151" }}>
          Context files{" "}
          <span style={{ color: "#888" }}>
            (optional — attached right after the room is created)
          </span>
        </span>
        <DashboardAttachButton
          archived={false}
          onQueue={(item) => setPending((p) => [...p, item])}
        />
        {pending.length > 0 && (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "grid",
              gap: 4,
              fontSize: 13,
            }}
          >
            {pending.map((item, i) => (
              <li
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 480,
                  }}
                >
                  {pendingLabel(item)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${pendingLabel(item)}`}
                  onClick={() =>
                    setPending((p) => p.filter((_, j) => j !== i))
                  }
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#888",
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
        <span style={{ fontSize: 13, color: "#374151" }}>
          Invite participants{" "}
          <span style={{ color: "#888" }}>
            (optional — emails go out right after the room is created)
          </span>
        </span>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "flex-start",
            width: "100%",
          }}
        >
          <InviteeAutocomplete
            email={inviteEmail}
            onEmailChange={setInviteEmail}
            onPick={(s) => {
              setInviteEmail(s.email);
              setInviteName(s.displayName);
            }}
            disabled={busy}
          />
          <input
            type="text"
            placeholder="Name"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            disabled={busy}
            style={{
              flex: "1 1 150px",
              padding: "6px 10px",
              fontSize: 14,
              border: "1px solid #d1d5db",
              borderRadius: 6,
            }}
          />
          <button
            type="button"
            onClick={addInvite}
            disabled={busy || !inviteEmail.includes("@") || !inviteName.trim()}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: "#1f2937",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>
        {pendingInvites.length > 0 && (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "grid",
              gap: 4,
              fontSize: 13,
            }}
          >
            {pendingInvites.map((inv, i) => (
              <li
                key={inv.email}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 480,
                  }}
                >
                  {inv.name} &lt;{inv.email}&gt;
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${inv.email}`}
                  onClick={() =>
                    setPendingInvites((p) => p.filter((_, j) => j !== i))
                  }
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#888",
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label style={{ display: "grid", gap: 4 }}>
        <span
          style={{
            fontSize: 13,
            color: "#374151",
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>
            System prompt <span style={{ color: "#888" }}>(optional)</span>
          </span>
          <span style={{ color: promptTooLong ? "#c00" : "#888", fontVariantNumeric: "tabular-nums" }}>
            {systemPrompt.length.toLocaleString()} / {MAX_SYSTEM_PROMPT_CHARS.toLocaleString()}
          </span>
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
            border: `1px solid ${promptTooLong ? "#c00" : "#d1d5db"}`,
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
        disabled={busy || !slugValid || !name.trim() || promptTooLong}
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
