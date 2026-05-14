"use client";
import { useEffect, useState } from "react";
import type { OpenPollView, ClosedPollView } from "@/lib/store";

export type PollViewAny = OpenPollView | ClosedPollView;

export function PollCard({
  poll,
  currentParticipantId,
  isAdmin,
}: {
  poll: PollViewAny;
  currentParticipantId: string;
  isAdmin: boolean;
}) {
  if (poll.status === "open") {
    return (
      <PollCardOpen
        poll={poll}
        currentParticipantId={currentParticipantId}
        isAdmin={isAdmin}
      />
    );
  }
  return <PollCardClosed poll={poll} currentParticipantId={currentParticipantId} />;
}

function secondsUntil(ts: number | null): number {
  if (ts == null) return 0;
  return Math.max(0, Math.floor((ts - Date.now()) / 1000));
}

function fmtCountdown(s: number): string {
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function PollCardOpen({
  poll,
  currentParticipantId,
  isAdmin,
}: {
  poll: OpenPollView;
  currentParticipantId: string;
  isAdmin: boolean;
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(poll.closesAt));
  const [voting, setVoting] = useState(false);
  // Optimistic local selection — the SSE poll_vote event only carries
  // {pollId, totalVotes}, so without this the controlled radio wouldn't
  // light up until a snapshot refresh.
  const [mySelectedOptionId, setMySelectedOptionId] = useState<string | null>(
    poll.myVoteOptionId,
  );
  const canClose = poll.authorId === currentParticipantId || isAdmin;

  useEffect(() => {
    if (poll.closesAt == null) return;
    setRemaining(secondsUntil(poll.closesAt));
    const t = setInterval(() => setRemaining(secondsUntil(poll.closesAt)), 1000);
    return () => clearInterval(t);
  }, [poll.closesAt]);

  useEffect(() => {
    setMySelectedOptionId(poll.myVoteOptionId);
  }, [poll.myVoteOptionId]);

  async function vote(optionId: string) {
    if (voting) return;
    const previous = mySelectedOptionId;
    setMySelectedOptionId(optionId);
    setVoting(true);
    try {
      const res = await fetch(
        `/api/room/${poll.roomId}/poll/${poll.id}/vote`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ optionId }),
        },
      );
      if (!res.ok) setMySelectedOptionId(previous);
    } catch {
      setMySelectedOptionId(previous);
    } finally {
      setVoting(false);
    }
  }

  async function closeNow() {
    await fetch(`/api/room/${poll.roomId}/poll/${poll.id}/close`, { method: "POST" });
  }

  return (
    <div className="poll-card poll-card--open">
      <div className="poll-card-header">
        🗳️ Poll from <strong>{poll.authorName}</strong> ·{" "}
        {poll.closesAt == null
          ? "manual close"
          : remaining > 0
            ? `ends in ${fmtCountdown(remaining)}`
            : "closing…"}
      </div>
      <div className="poll-question">{poll.question}</div>
      <ul className="poll-options">
        {poll.options.map(o => {
          const selected = mySelectedOptionId === o.id;
          return (
            <li key={o.id}>
              <label
                className={
                  "poll-option-label" +
                  (selected ? " poll-option-label--selected" : "")
                }
              >
                <input
                  type="radio"
                  name={`poll-${poll.id}`}
                  checked={selected}
                  onChange={() => void vote(o.id)}
                  disabled={voting}
                />
                <span>{o.text}</span>
                {selected && (
                  <span className="poll-your-vote"> ← your vote</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="poll-card-footer">
        <span className="poll-meta">
          {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"} · results hidden until close
        </span>
        {canClose && (
          <button onClick={() => void closeNow()} className="poll-close-btn">
            Close now
          </button>
        )}
      </div>
    </div>
  );
}

function PollCardClosed({
  poll,
  currentParticipantId: _currentParticipantId,
}: {
  poll: ClosedPollView;
  currentParticipantId: string;
}) {
  const maxVotes = Math.max(1, ...poll.tallies.map(t => t.votes));
  const winnerText = poll.winnerOptionId
    ? poll.tallies.find(t => t.optionId === poll.winnerOptionId)?.text ?? null
    : null;

  return (
    <div className="poll-card poll-card--closed">
      <div className="poll-card-header">
        🗳️ Poll from <strong>{poll.authorName}</strong> ·{" "}
        {poll.closedBy === "auto" ? "auto-closed" : "closed early"} · {poll.totalVotes}{" "}
        {poll.totalVotes === 1 ? "vote" : "votes"}
      </div>
      <div className="poll-question">{poll.question}</div>
      <ul className="poll-tallies">
        {poll.tallies.map(t => (
          <li key={t.optionId} className={t.optionId === poll.winnerOptionId ? "winner" : ""}>
            <span className="poll-tally-text">{t.text}</span>
            <span
              className="poll-tally-bar"
              style={{ width: `${(t.votes / maxVotes) * 100}%` }}
            />
            <span className="poll-tally-count">{t.votes}</span>
          </li>
        ))}
      </ul>
      <div className="poll-card-footer">
        {winnerText ? (
          <span>
            Winner: <strong>&ldquo;{winnerText}&rdquo;</strong>
          </span>
        ) : poll.totalVotes === 0 ? (
          <span className="poll-meta">No votes cast.</span>
        ) : (
          <span className="poll-meta">Tie.</span>
        )}
      </div>
    </div>
  );
}
