"use client";

import { useState } from "react";
import { MIN_PROMPT_DESCRIPTION_CHARS } from "@/lib/prompt-gen";

/**
 * "Generate prompt" control shared by every system-prompt textarea: the
 * landing admin create card, the dashboard create form, the dashboard room
 * settings editor, and the in-room settings modal.
 *
 * The textarea the user is already typing into IS the input — `value` is sent
 * to /api/generate-prompt as a plain-English description, the LLM returns a
 * structured system prompt, and we show it in a preview. Accept replaces the
 * field via `onAccept`; Discard dismisses the preview and leaves the field
 * untouched. `adminToken`, when supplied, is sent as the x-admin-token header
 * so the landing card (which has no creator cookie) authenticates.
 */
export default function GeneratePromptButton({
  value,
  onAccept,
  disabled = false,
  adminToken,
}: {
  value: string;
  onAccept: (generated: string) => void;
  disabled?: boolean;
  adminToken?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tooShort = value.trim().length < MIN_PROMPT_DESCRIPTION_CHARS;
  const canGenerate = !disabled && !tooShort && !loading;

  async function generate() {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (adminToken) headers["x-admin-token"] = adminToken;
      const res = await fetch("/api/generate-prompt", {
        method: "POST",
        headers,
        body: JSON.stringify({ description: value }),
      });
      if (res.status === 429) {
        setError("Too many requests — wait a moment and try again.");
        return;
      }
      if (!res.ok) {
        setError("Could not generate a prompt. Try again.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (typeof data.prompt === "string" && data.prompt.trim()) {
        setPreview(data.prompt);
      } else {
        setError("The generator returned nothing. Try rephrasing your description.");
      }
    } catch {
      setError("Could not reach the generator. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
      <div>
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          title={
            tooShort
              ? "Describe how the AI should behave first (at least a sentence)."
              : undefined
          }
          style={{
            padding: "6px 12px",
            fontSize: 13,
            background: canGenerate ? "#1f2937" : "#9ca3af",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: canGenerate ? "pointer" : "not-allowed",
          }}
        >
          {loading ? "Generating…" : "✨ Generate prompt"}
        </button>
        <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>
          Describe the AI&apos;s role in plain English, then generate a structured prompt.
        </span>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "#c00" }}>
          {error}
        </p>
      )}

      {preview !== null && (
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: 10,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            background: "#f9fafb",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
            Generated prompt — preview
          </span>
          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              color: "#111827",
            }}
          >
            {preview}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setPreview(null)}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                background: "white",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => {
                onAccept(preview);
                setPreview(null);
              }}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                background: "#166534",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
