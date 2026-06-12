"use client";

import { useState } from "react";

export default function DashboardAttachButton({
  roomId,
  archived,
}: {
  roomId: string;
  archived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubInclude, setGithubInclude] = useState("");
  const [githubExclude, setGithubExclude] = useState("");
  const [githubPreview, setGithubPreview] = useState<{
    fileCount: number;
    charCount: number;
  } | null>(null);
  const [urlSource, setUrlSource] = useState("");
  const [urlInstruction, setUrlInstruction] = useState("");

  if (archived) return null;

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/dashboard/room/${roomId}/upload`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function previewGitHub() {
    setBusy(true);
    try {
      const res = await fetch(`/api/room/${roomId}/context/github/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: githubUrl,
          include: githubInclude,
          exclude: githubExclude,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(`Preview failed: ${body.error ?? res.status}`);
        return;
      }
      setGithubPreview({
        fileCount: Number(body.preview?.sourceMeta?.fileCount ?? 0),
        charCount: Number(body.preview?.sourceMeta?.charCount ?? 0),
      });
    } finally {
      setBusy(false);
    }
  }

  async function attachGitHub(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/dashboard/room/${roomId}/context/github`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: githubUrl,
            include: githubInclude,
            exclude: githubExclude,
          }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(`GitHub attach failed: ${body.error ?? res.status}`);
        return;
      }
      setGithubOpen(false);
      setGithubUrl("");
      setGithubInclude("");
      setGithubExclude("");
      setGithubPreview(null);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function attachUrl(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/dashboard/room/${roomId}/context/url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: urlSource, instruction: urlInstruction }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(`URL attach failed: ${body.error ?? res.status}`);
        return;
      }
      setUrlOpen(false);
      setUrlSource("");
      setUrlInstruction("");
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  const btn = (label: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => setOpen((o) => !o)}
      style={{
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 600,
        background: "white",
        color: busy ? "#9ca3af" : "var(--navy)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        cursor: busy ? "not-allowed" : "pointer",
      }}
    >
      {busy ? "…" : label}
    </button>
  );

  return (
    <span style={{ position: "relative" }}>
      {btn("+ Attach")}
      {open && (
        <>
          {/* Backdrop to close menu */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              background: "white",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              zIndex: 50,
              overflow: "hidden",
              minWidth: 180,
            }}
          >
            <label
              style={{
                display: "block",
                padding: "10px 12px",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Upload file
              <input
                type="file"
                hidden
                accept=".pdf,.docx,.txt,.md"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                  setOpen(false);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setGithubOpen(true);
                setOpen(false);
              }}
              style={menuItemStyle()}
            >
              Attach GitHub repo
            </button>
            <button
              type="button"
              onClick={() => {
                setUrlOpen(true);
                setOpen(false);
              }}
              style={menuItemStyle()}
            >
              Scrape URL
            </button>
          </div>
        </>
      )}
      {err && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "#fef2f2",
            color: "#991b1b",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            whiteSpace: "nowrap",
            zIndex: 50,
            border: "1px solid #fecaca",
          }}
        >
          {err}{" "}
          <button
            type="button"
            onClick={() => setErr(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              marginLeft: 4,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* GitHub modal */}
      {githubOpen && (
        <Modal
          title="Attach GitHub repo"
          onClose={() => setGithubOpen(false)}
        >
          <form onSubmit={attachGitHub} style={{ display: "grid", gap: 10 }}>
            <input
              required
              value={githubUrl}
              onChange={(e) => {
                setGithubUrl(e.target.value);
                setGithubPreview(null);
              }}
              placeholder="https://github.com/owner/repo"
              style={inp()}
            />
            <input
              value={githubInclude}
              onChange={(e) => setGithubInclude(e.target.value)}
              placeholder="Include globs, comma-separated (default: READMEs only)"
              style={inp()}
            />
            <input
              value={githubExclude}
              onChange={(e) => setGithubExclude(e.target.value)}
              placeholder="Exclude globs, comma-separated (optional)"
              style={inp()}
            />
            <p style={{ margin: 0, fontSize: 12, color: "#666" }}>
              Leave Include blank to attach just the README. To pull source or
              docs, list globs like{" "}
              <code>**/*.md, src/**/*.ts</code>.
            </p>
            {githubPreview && (
              <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
                Preview: {githubPreview.fileCount} files,{" "}
                {githubPreview.charCount.toLocaleString()} characters
              </p>
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                disabled={busy || !githubUrl.trim()}
                onClick={() => void previewGitHub()}
                style={btnSecondary()}
              >
                Preview
              </button>
              <button
                type="submit"
                disabled={busy || !githubUrl.trim()}
                style={btnPrimary()}
              >
                {busy ? "Attaching…" : "Attach repo"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* URL modal */}
      {urlOpen && (
        <Modal title="Scrape URL" onClose={() => setUrlOpen(false)}>
          <form onSubmit={attachUrl} style={{ display: "grid", gap: 10 }}>
            <input
              required
              value={urlSource}
              onChange={(e) => setUrlSource(e.target.value)}
              placeholder="https://example.com/report"
              style={inp()}
            />
            <input
              required
              value={urlInstruction}
              onChange={(e) => setUrlInstruction(e.target.value)}
              placeholder="Just the methodology section"
              style={inp()}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={
                  busy || !urlSource.trim() || !urlInstruction.trim()
                }
                style={btnPrimary()}
              >
                {busy ? "Attaching…" : "Attach URL"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </span>
  );
}

function menuItemStyle(): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    border: "none",
    borderBottom: "1px solid var(--border)",
    background: "white",
    cursor: "pointer",
    fontSize: 13,
    font: "inherit",
  };
}

function inp(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    fontSize: 14,
    border: "1px solid var(--border)",
    borderRadius: 6,
    boxSizing: "border-box",
    outline: "none",
  };
}

function btnPrimary(): React.CSSProperties {
  return {
    padding: "8px 16px",
    fontSize: 14,
    fontWeight: 600,
    background: "var(--navy)",
    color: "white",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  };
}

function btnSecondary(): React.CSSProperties {
  return {
    padding: "8px 16px",
    fontSize: 14,
    fontWeight: 600,
    background: "white",
    color: "var(--navy)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    cursor: "pointer",
  };
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          width: "min(520px, 100%)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
          fontFamily: "system-ui, sans-serif",
          color: "var(--navy)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 24,
              lineHeight: 1,
              cursor: "pointer",
              color: "var(--muted)",
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}
