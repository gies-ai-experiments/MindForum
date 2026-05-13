"use client";
import { useEffect, useState } from "react";

type Draft = { question: string; options: string[] };
type Duration = "5m" | "15m" | "1h" | "24h" | "manual";

export function PollLaunchModal({
  roomId, onClose, onLaunched,
}: {
  roomId: string;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [duration, setDuration] = useState<Duration>("1h");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function fetchDraft() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/room/${roomId}/poll/draft`, { method: "POST" });
      if (r.status === 429) {
        setError("Slow down — try again in a moment.");
        setLoading(false);
        return;
      }
      const d = (await r.json()) as Draft;
      setQuestion(d.question ?? "");
      setOptions(d.options && d.options.length >= 2 ? d.options : ["", ""]);
    } catch {
      setError("AI draft unavailable — fill in manually.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchDraft(); }, []);

  const trimmed = options.map(o => o.trim()).filter(Boolean);
  const uniqueCount = new Set(trimmed.map(s => s.toLowerCase())).size;
  const allUnique = uniqueCount === trimmed.length;
  const canLaunch = question.trim().length > 0 && trimmed.length >= 2 && allUnique && !submitting;

  async function launch() {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/room/${roomId}/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, options, duration }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setError(e.error ?? "unknown_error");
        return;
      }
      onLaunched();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--poll" onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <h2>Propose a vote</h2>
          <button onClick={onClose} aria-label="Close" className="modal__close">✕</button>
        </header>
        {loading ? (
          <div className="poll-draft-loading">✨ Drafting from recent conversation…</div>
        ) : (
          <div className="modal__body">
            <label className="poll-label">Question</label>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={2}
              maxLength={500}
              className="poll-input"
              placeholder="What should we decide?"
            />

            <label className="poll-label">Options</label>
            {options.map((o, i) => (
              <div key={i} className="poll-option-row">
                <input
                  value={o}
                  onChange={e =>
                    setOptions(opts => opts.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  placeholder={`Option ${i + 1}`}
                  className="poll-input"
                />
                {options.length > 2 && (
                  <button
                    onClick={() => setOptions(opts => opts.filter((_, j) => j !== i))}
                    aria-label="Remove option"
                    className="poll-option-remove"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {options.length < 5 && (
              <button
                onClick={() => setOptions(opts => [...opts, ""])}
                className="poll-add-option"
              >
                + Add option
              </button>
            )}

            <label className="poll-label">Closes in</label>
            <div className="poll-duration">
              {(["5m", "15m", "1h", "24h", "manual"] as Duration[]).map(d => (
                <label key={d} className="poll-duration-opt">
                  <input
                    type="radio"
                    name="duration"
                    checked={duration === d}
                    onChange={() => setDuration(d)}
                  />
                  {d === "manual" ? "Manual close only" : d}
                </label>
              ))}
            </div>

            {error && <div className="poll-error">Error: {error}</div>}

            <footer className="modal__footer">
              <button onClick={() => void fetchDraft()} disabled={submitting} className="poll-redraft">
                ↻ Re-draft from chat
              </button>
              <button onClick={onClose} className="poll-cancel">Cancel</button>
              <button onClick={launch} disabled={!canLaunch} className="poll-launch">
                {submitting ? "Launching…" : "Launch"}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
