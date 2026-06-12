"use client";

import { useState } from "react";

type FileRow = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: number;
  selected: boolean;
  sourceType: "uploaded" | "github_repo" | "web_url";
  sourceUrl: string | null;
  sourceMeta: Record<string, unknown> | null;
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPanel({
  roomId,
  files: initial,
  archived,
}: {
  roomId: string;
  files: FileRow[];
  archived: boolean;
}) {
  const [files, setFiles] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Attach controls
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubInclude, setGithubInclude] = useState("");
  const [githubExclude, setGithubExclude] = useState("");
  const [githubPreview, setGithubPreview] = useState<{
    fileCount: number;
    charCount: number;
  } | null>(null);
  const [urlSource, setUrlSource] = useState("");
  const [urlInstruction, setUrlInstruction] = useState("");

  async function deleteFile(fileId: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setBusyId(fileId);
    setErr(null);
    try {
      const res = await fetch(`/api/room/${fileId}/files/${fileId}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 204) {
        setFiles((cur) => cur.filter((f) => f.id !== fileId));
      } else if (res.status === 410) {
        setErr("Room is archived — restore first.");
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

  async function toggleSelected(fileId: string, next: boolean) {
    setBusyId(fileId);
    setErr(null);
    try {
      const res = await fetch(`/api/room/${roomId}/files`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId, selected: next }),
      });
      if (res.ok) {
        setFiles((cur) =>
          cur.map((f) => (f.id === fileId ? { ...f, selected: next } : f))
        );
      } else if (res.status === 410) {
        setErr("Room is archived — restore first.");
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

  // ---- Attach handlers (dashboard API routes) ----

  async function upload(file: File) {
    setAttachBusy(true);
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
      if (body.file) {
        setFiles((cur) => [
          ...cur,
          {
            id: body.file.id,
            name: body.file.name,
            mime: body.file.mime,
            sizeBytes: body.file.sizeBytes,
            uploadedAt: Date.now(),
            selected: true,
            sourceType: body.file.sourceType ?? "uploaded",
            sourceUrl: body.file.sourceUrl ?? null,
            sourceMeta: body.file.sourceMeta ?? null,
          },
        ]);
      }
    } finally {
      setAttachBusy(false);
    }
  }

  async function previewGitHub() {
    setAttachBusy(true);
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
        setErr(`GitHub preview failed: ${body.error ?? res.status}`);
        return;
      }
      setGithubPreview({
        fileCount: Number(body.preview?.sourceMeta?.fileCount ?? 0),
        charCount: Number(body.preview?.sourceMeta?.charCount ?? 0),
      });
    } finally {
      setAttachBusy(false);
    }
  }

  async function attachGitHub(e: React.FormEvent) {
    e.preventDefault();
    setAttachBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/dashboard/room/${roomId}/context/github`, {
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
        setErr(`GitHub attach failed: ${body.error ?? res.status}`);
        return;
      }
      setGithubModalOpen(false);
      setGithubUrl("");
      setGithubInclude("");
      setGithubExclude("");
      setGithubPreview(null);
      if (body.file) {
        setFiles((cur) => [
          ...cur,
          {
            id: body.file.id,
            name: body.file.name,
            mime: body.file.mime,
            sizeBytes: body.file.sizeBytes,
            uploadedAt: Date.now(),
            selected: true,
            sourceType: body.file.sourceType ?? "github_repo",
            sourceUrl: body.file.sourceUrl ?? null,
            sourceMeta: body.file.sourceMeta ?? null,
          },
        ]);
      }
    } finally {
      setAttachBusy(false);
    }
  }

  async function attachUrl(e: React.FormEvent) {
    e.preventDefault();
    setAttachBusy(true);
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
      setUrlModalOpen(false);
      setUrlSource("");
      setUrlInstruction("");
      if (body.file) {
        setFiles((cur) => [
          ...cur,
          {
            id: body.file.id,
            name: body.file.name,
            mime: body.file.mime,
            sizeBytes: body.file.sizeBytes,
            uploadedAt: Date.now(),
            selected: true,
            sourceType: body.file.sourceType ?? "web_url",
            sourceUrl: body.file.sourceUrl ?? null,
            sourceMeta: body.file.sourceMeta ?? null,
          },
        ]);
      }
    } finally {
      setAttachBusy(false);
    }
  }

  return (
    <div>
      {err && (
        <p role="alert" style={{ color: "#c00", fontSize: 13, marginTop: 0, marginBottom: 8 }}>
          {err}
        </p>
      )}

      {/* Attach controls */}
      {!archived && (
        <div style={{ marginBottom: 12, position: "relative" }}>
          <button
            type="button"
            disabled={attachBusy}
            onClick={() => setAttachMenuOpen((open) => !open)}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 600,
              background: "white",
              color: attachBusy ? "#9ca3af" : "var(--navy)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: attachBusy ? "not-allowed" : "pointer",
            }}
          >
            {attachBusy ? "Working…" : "+ Attach"}
          </button>
          {attachMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                background: "white",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                zIndex: 20,
                overflow: "hidden",
                minWidth: 200,
              }}
            >
              <label
                style={{
                  display: "block",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Upload file
                <input
                  type="file"
                  hidden
                  accept=".pdf,.docx,.txt,.md"
                  disabled={attachBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(f);
                    e.target.value = "";
                    setAttachMenuOpen(false);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setGithubModalOpen(true);
                  setAttachMenuOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 14,
                  font: "inherit",
                }}
              >
                Attach GitHub repo
              </button>
              <button
                type="button"
                onClick={() => {
                  setUrlModalOpen(true);
                  setAttachMenuOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 14,
                  font: "inherit",
                }}
              >
                Scrape URL
              </button>
            </div>
          )}
        </div>
      )}

      {files.length === 0 && !archived && (
        <p style={{ color: "#666", fontSize: 13 }}>
          No files yet. Use the Attach button above, or upload from inside the room.
        </p>
      )}
      {files.length === 0 && archived && (
        <p style={{ color: "#666", fontSize: 13 }}>
          No files. Upload from inside the room.
        </p>
      )}

      {files.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
              <th style={{ padding: 6, fontSize: 13 }}>In AI context</th>
              <th style={{ padding: 6, fontSize: 13 }}>Name</th>
              <th style={{ padding: 6, fontSize: 13, textAlign: "right" }}>Size</th>
              <th style={{ padding: 6, fontSize: 13 }}>Uploaded</th>
              <th style={{ padding: 6, fontSize: 13 }}></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td style={{ padding: 6 }}>
                  <input
                    type="checkbox"
                    checked={f.selected}
                    disabled={busyId === f.id || archived}
                    onChange={(e) => toggleSelected(f.id, e.target.checked)}
                  />
                </td>
                <td style={{ padding: 6, fontSize: 14, maxWidth: 360 }}>
                  <div>
                    {f.name}{" "}
                    <span style={badgeStyle(f.sourceType)}>
                      {sourceLabel(f.sourceType)}
                    </span>
                  </div>
                  {f.sourceUrl && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "#666",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={f.sourceUrl}
                    >
                      {f.sourceUrl}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: 6,
                    fontSize: 13,
                    textAlign: "right",
                    color: "#666",
                  }}
                >
                  {fmtSize(f.sizeBytes)}
                </td>
                <td style={{ padding: 6, fontSize: 13, color: "#666" }}>
                  {new Date(f.uploadedAt).toISOString().slice(0, 10)}
                </td>
                <td style={{ padding: 6, fontSize: 13, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => deleteFile(f.id, f.name)}
                    disabled={busyId === f.id || archived}
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      background: "white",
                      color: archived ? "#9ca3af" : "#991b1b",
                      border: "1px solid",
                      borderColor: archived ? "#e5e7eb" : "#fecaca",
                      borderRadius: 4,
                      cursor: archived ? "not-allowed" : "pointer",
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* GitHub attach modal */}
      {githubModalOpen && (
        <Modal title="Attach GitHub repo" onClose={() => setGithubModalOpen(false)}>
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
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                type="button"
                disabled={attachBusy || !githubUrl.trim()}
                onClick={() => void previewGitHub()}
                style={btnSecondary()}
              >
                Preview
              </button>
              <button
                type="submit"
                disabled={attachBusy || !githubUrl.trim()}
                style={btnPrimary()}
              >
                {attachBusy ? "Attaching…" : "Attach repo"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* URL attach modal */}
      {urlModalOpen && (
        <Modal title="Scrape URL" onClose={() => setUrlModalOpen(false)}>
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
                  attachBusy || !urlSource.trim() || !urlInstruction.trim()
                }
                style={btnPrimary()}
              >
                {attachBusy ? "Attaching…" : "Attach URL"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function sourceLabel(sourceType: FileRow["sourceType"]): string {
  if (sourceType === "github_repo") return "github";
  if (sourceType === "web_url") return "url";
  return "file";
}

function badgeStyle(sourceType: FileRow["sourceType"]): React.CSSProperties {
  const color =
    sourceType === "github_repo"
      ? "#334155"
      : sourceType === "web_url"
        ? "#075985"
        : "#6b7280";
  return {
    display: "inline-block",
    marginLeft: 4,
    padding: "1px 6px",
    borderRadius: 999,
    fontSize: 11,
    color,
    background: "rgba(15,23,42,0.06)",
  };
}

// ---- Shared styles ----

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
