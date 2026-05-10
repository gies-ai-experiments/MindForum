"use client";

import { useState } from "react";

type FileRow = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: number;
  selected: boolean;
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

  async function deleteFile(fileId: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setBusyId(fileId);
    setErr(null);
    try {
      const res = await fetch(`/api/room/${roomId}/files/${fileId}`, {
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

  if (files.length === 0) {
    return (
      <p style={{ color: "#666", fontSize: 13 }}>
        No files yet. Upload from inside the room.
      </p>
    );
  }

  return (
    <div>
      {err && (
        <p role="alert" style={{ color: "#c00", fontSize: 13, marginTop: 0 }}>
          {err}
        </p>
      )}
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
              <td style={{ padding: 6, fontSize: 14 }}>{f.name}</td>
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
    </div>
  );
}
