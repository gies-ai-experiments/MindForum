"use client";
import { useEffect, useRef, useState, use } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TextareaAutosize from "react-textarea-autosize";
import {
  DEFAULT_PREFS,
  type NotifyPrefs,
  flashTitle,
  loadPrefs,
  matchesMention,
  notificationPermission,
  playPing,
  requestNotificationPermission,
  resetTitle,
  savePrefs,
  showToast,
} from "@/lib/notify";
import { PollLaunchModal } from "./PollLaunchModal";
import { PollCard } from "./PollCard";

type Participant = { id: string; name: string; email: string; joinedAt: number };
type PublicFile = {
  id: string;
  roomId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedAt: number;
};
type FilePreview = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: number;
  uploadedById: string;
  uploaderName: string | null;
  uploaderEmail: string | null;
  extractedText: string;
};
type Reaction = { emoji: string; count: number; reacterIds: string[] };
type Msg = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
  kind?: "chat" | "brief";
  reactions?: Reaction[];
  editedAt?: number | null;
};
type PollOptionView = { id: string; pollId: string; position: number; text: string };
type OpenPoll = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  question: string;
  status: "open";
  createdAt: number;
  closesAt: number | null;
  closedAt: number | null;
  closedBy: string | null;
  options: PollOptionView[];
  totalVotes: number;
  myVoteOptionId: string | null;
};
type ClosedPoll = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  question: string;
  status: "closed";
  createdAt: number;
  closesAt: number | null;
  closedAt: number | null;
  closedBy: string | null;
  options: PollOptionView[];
  totalVotes: number;
  tallies: { optionId: string; text: string; votes: number }[];
  winnerOptionId: string | null;
  inconclusive: boolean;
};

type Snapshot = {
  id: string;
  name: string;
  systemPrompt?: string;
  archived?: boolean;
  participants: Participant[];
  messages: Msg[];
  files: PublicFile[];
  selectedFileIds: string[];
  openPolls?: OpenPoll[];
  recentClosedPolls?: ClosedPoll[];
};

export default function RoomPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);

  const [joined, setJoined] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [state, setState] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefPending, setBriefPending] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  type PinnedFacts = { names: string[]; decisions: string[]; files: string[] };
  type CatchupData =
    | { kind: "orientation"; files: { id: string; name: string }[] }
    | { kind: "summary"; bullets: string[]; pinnedFacts: PinnedFacts }
    | { kind: "error" };
  const [catchupOpen, setCatchupOpen] = useState(false);
  const [catchupData, setCatchupData] = useState<CatchupData | null>(null);
  const [catchupLoading, setCatchupLoading] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);

  const [participantId, setParticipantId] = useState<string>("");
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [unread, setUnread] = useState(0);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const isNarrow = useIsNarrow(720);
  const [participantsDrawerOpen, setParticipantsDrawerOpen] = useState(false);
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
  useEffect(() => {
    if (!isNarrow) {
      setParticipantsDrawerOpen(false);
      setFilesDrawerOpen(false);
    }
  }, [isNarrow]);

  const nameRef = useRef(name);
  const prefsRef = useRef(prefs);
  const participantIdRef = useRef(participantId);
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => {
    participantIdRef.current = participantId;
  }, [participantId]);

  // Fetch file content when the preview modal opens.
  useEffect(() => {
    if (!previewFileId) {
      setPreviewData(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    // Clear stale data from a previous file so we don't render A's content
    // while B is still loading after a fast switch.
    setPreviewData(null);
    setPreviewLoading(true);
    setPreviewError(null);
    fetch(`/api/room/${id}/files/${encodeURIComponent(previewFileId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<FilePreview>;
      })
      .then((data) => {
        if (!cancelled) setPreviewData(data);
      })
      .catch((e) => {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewFileId, id]);

  // Esc closes the preview modal + lock body scroll while open.
  useEffect(() => {
    if (!previewFileId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPreviewFileId(null);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [previewFileId]);

  // Prefill name + email from previous session so returning users don't retype.
  useEffect(() => {
    try {
      const savedName = localStorage.getItem("mindforum_name");
      const savedEmail = localStorage.getItem("mindforum_email");
      if (savedName) setName(savedName);
      if (savedEmail) setEmail(savedEmail);
    } catch {}
  }, []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      setJoinError("Name and email are both required.");
      return;
    }
    setJoinError("");
    setJoining(true);
    try {
      const res = await fetch(`/api/room/${id}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail }),
      });
      if (res.status === 404) {
        setJoinError("Room not found.");
        return;
      }
      if (res.status === 410) {
        setJoinError("This room is archived. Ask the room owner to restore it.");
        return;
      }
      if (!res.ok) {
        setJoinError("Could not join.");
        return;
      }
      const joinJson: {
        participantId: string | null;
        readOnly?: boolean;
        catchupHint?: { should: false } | { should: true; since: number | null };
      } = await res.json().catch(() => ({ participantId: "" }));
      try {
        localStorage.setItem("mindforum_name", trimmedName);
        localStorage.setItem("mindforum_email", trimmedEmail);
      } catch {}
      setParticipantId(joinJson.participantId ?? "");
      setJoined(true);

      if (joinJson.catchupHint?.should) {
        setCatchupOpen(true);
        setCatchupLoading(true);
        // The catchup endpoint now serves a single rolling summary for the room;
        // the `since` hint still controls whether we show the modal but no longer
        // shapes the response.
        fetch(`/api/room/${id}/catchup`)
          .then((r) => (r.ok ? r.json() : Promise.reject(r)))
          .then((data: CatchupData) => setCatchupData(data))
          .catch(() => setCatchupData({ kind: "error" }))
          .finally(() => setCatchupLoading(false));
      }
    } finally {
      setJoining(false);
    }
  }

  useEffect(() => {
    if (!joined) return;
    const es = new EventSource(`/api/room/${id}/stream`);
    es.addEventListener("snapshot", (ev) => {
      setState(JSON.parse((ev as MessageEvent).data));
    });
    es.addEventListener("participant_joined", (ev) => {
      const p: Participant = JSON.parse((ev as MessageEvent).data);
      setState((s) => (s ? { ...s, participants: upsertById(s.participants, p) } : s));
    });
    es.addEventListener("message_added", (ev) => {
      const m: Msg = JSON.parse((ev as MessageEvent).data);

      const prevLast = messagesRef.current[messagesRef.current.length - 1];
      const myId = participantIdRef.current;
      const myName = nameRef.current;
      const p = prefsRef.current;
      const isOwn = myId !== "" && m.authorId === myId;
      const isAi = m.authorId === "ai";
      const focused =
        typeof document !== "undefined" && !document.hidden && document.hasFocus();

      let trigger: { title: string; body: string } | null = null;
      if (!isOwn && !focused) {
        if (isAi) {
          if (
            p.aiReplies &&
            prevLast &&
            myId !== "" &&
            prevLast.authorId === myId &&
            m.content.trim().length > 0
          ) {
            trigger = { title: "AI replied", body: snippet(m.content) };
          }
        } else {
          const match = matchesMention(m.content, myName, { mentionAll: p.mentionAll });
          if (match?.kind === "direct") {
            trigger = {
              title: `${m.authorName} mentioned you`,
              body: snippet(m.content),
            };
          } else if (match?.kind === "all") {
            trigger = {
              title: `${m.authorName} pinged the room`,
              body: snippet(m.content),
            };
          }
        }
      }

      if (trigger) {
        setUnread((n) => n + 1);
        if (p.toast) showToast(trigger.title, trigger.body);
        if (p.sound) playPing();
      }

      setState((s) => (s ? { ...s, messages: [...s.messages, m] } : s));
      if (m.kind === "brief") setBriefPending(false);
    });
    es.addEventListener("message_token", (ev) => {
      const { id: mid, delta } = JSON.parse((ev as MessageEvent).data) as {
        id: string;
        delta: string;
      };
      setState((s) =>
        s
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === mid ? { ...m, content: m.content + delta } : m
              ),
            }
          : s
      );
    });
    es.addEventListener("message_updated", (ev) => {
      const { id: mid, content, editedAt } = JSON.parse((ev as MessageEvent).data) as {
        id: string;
        content: string;
        editedAt?: number;
      };
      setState((s) =>
        s
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === mid
                  ? {
                      ...m,
                      content,
                      ...(editedAt !== undefined ? { editedAt } : {}),
                    }
                  : m
              ),
            }
          : s
      );
    });
    es.addEventListener("file_added", (ev) => {
      const f: PublicFile = JSON.parse((ev as MessageEvent).data);
      setState((s) => (s ? { ...s, files: upsertById(s.files, f) } : s));
    });
    es.addEventListener("room_archived", () => {
      setState((s) => (s ? { ...s, archived: true } : s));
    });
    es.addEventListener("room_restored", () => {
      setState((s) => (s ? { ...s, archived: false } : s));
    });
    es.addEventListener("participant_removed", (ev) => {
      const { id: removedId } = JSON.parse((ev as MessageEvent).data) as { id: string };
      setState((s) =>
        s ? { ...s, participants: s.participants.filter((p) => p.id !== removedId) } : s
      );
    });
    es.addEventListener("reaction_changed", (ev) => {
      const { messageId, reactions } = JSON.parse((ev as MessageEvent).data) as {
        messageId: string;
        reactions: Reaction[];
      };

      const myId = participantIdRef.current;
      const p = prefsRef.current;
      const focused =
        typeof document !== "undefined" && !document.hidden && document.hasFocus();
      const target = messagesRef.current.find((mm) => mm.id === messageId);

      // Reaction notify: someone reacted to MY message with an emoji that's
      // new (not in the prior reacterIds list) and the new reacter isn't me.
      if (
        p.reactions &&
        !focused &&
        target &&
        myId !== "" &&
        target.authorId === myId
      ) {
        const prevByEmoji = new Map(
          (target.reactions ?? []).map((r) => [r.emoji, new Set(r.reacterIds)])
        );
        let added: { emoji: string; reacter: string } | null = null;
        for (const r of reactions) {
          const prev = prevByEmoji.get(r.emoji) ?? new Set<string>();
          const newReacter = r.reacterIds.find((rid) => rid !== myId && !prev.has(rid));
          if (newReacter) {
            added = { emoji: r.emoji, reacter: newReacter };
            break;
          }
        }
        if (added) {
          setUnread((n) => n + 1);
          if (p.toast)
            showToast("New reaction", `${added.emoji} on your message`);
          if (p.sound) playPing();
        }
      }

      setState((s) =>
        s
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === messageId ? { ...m, reactions } : m
              ),
            }
          : s
      );
    });
    es.addEventListener("file_selection_changed", (ev) => {
      const { selectedFileIds } = JSON.parse((ev as MessageEvent).data);
      setState((s) => (s ? { ...s, selectedFileIds } : s));
    });
    es.addEventListener("poll_opened", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        pollId: string;
        roomId: string;
        question: string;
        options: PollOptionView[];
        closesAt: number | null;
        authorId: string;
        authorName: string;
        createdAt: number;
      };
      const fresh: OpenPoll = {
        id: data.pollId,
        roomId: data.roomId,
        authorId: data.authorId,
        authorName: data.authorName,
        question: data.question,
        status: "open",
        createdAt: data.createdAt,
        closesAt: data.closesAt,
        closedAt: null,
        closedBy: null,
        options: data.options,
        totalVotes: 0,
        myVoteOptionId: null,
      };
      setState((s) =>
        s ? { ...s, openPolls: [...(s.openPolls ?? []), fresh] } : s,
      );
    });
    es.addEventListener("poll_vote", (ev) => {
      const { pollId, totalVotes } = JSON.parse((ev as MessageEvent).data) as {
        pollId: string;
        totalVotes: number;
      };
      setState((s) =>
        s
          ? {
              ...s,
              openPolls: (s.openPolls ?? []).map((p) =>
                p.id === pollId ? { ...p, totalVotes } : p,
              ),
            }
          : s,
      );
    });
    es.addEventListener("poll_closed", (ev) => {
      const closed = JSON.parse((ev as MessageEvent).data) as ClosedPoll;
      setState((s) =>
        s
          ? {
              ...s,
              openPolls: (s.openPolls ?? []).filter((p) => p.id !== closed.id),
              recentClosedPolls: [...(s.recentClosedPolls ?? []), closed],
            }
          : s,
      );
    });
    es.onerror = () => {
      /* EventSource auto-reconnects */
    };
    return () => es.close();
  }, [id, joined]);

  // Autoscroll on new messages and while the last message is streaming.
  const lastMsgLen = state?.messages[state.messages.length - 1]?.content?.length ?? 0;
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [state?.messages.length, lastMsgLen]);

  // Keep messagesRef in sync so the SSE handler can inspect the previous message
  // without re-subscribing the EventSource.
  useEffect(() => {
    messagesRef.current = state?.messages ?? [];
  }, [state?.messages]);

  // Load notification prefs + current permission state once per room.
  useEffect(() => {
    setPrefs(loadPrefs(id));
    setPerm(notificationPermission());
    setPrefsLoaded(true);
  }, [id]);

  // Persist prefs whenever they change — only after the initial load,
  // so we don't clobber saved prefs with defaults on first render.
  useEffect(() => {
    if (!prefsLoaded) return;
    savePrefs(id, prefs);
  }, [id, prefs, prefsLoaded]);

  // Reset unread + title when the user looks at the tab again.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden && document.hasFocus()) {
        setUnread(0);
        resetTitle();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // Flash the document title with the unread mention count.
  useEffect(() => {
    flashTitle(unread);
  }, [unread]);

  // Restore original title when leaving the room.
  useEffect(() => {
    return () => {
      resetTitle();
    };
  }, []);

  async function enableBrowserNotifications() {
    const result = await requestNotificationPermission();
    setPerm(result);
    if (result === "granted") setPrefs((p) => ({ ...p, toast: true }));
  }

  function updatePref<K extends keyof NotifyPrefs>(key: K, value: NotifyPrefs[K]) {
    setPrefs((p) => ({ ...p, [key]: value }));
    if (key === "toast" && value === true && perm === "default") {
      void enableBrowserNotifications();
    }
  }

  function quoteReply(m: Msg) {
    const snip = m.content.replace(/\s+/g, " ").trim().slice(0, 140);
    const author = m.authorId === "ai" ? "AI" : m.authorName;
    const block = `> ${author}: ${snip}\n\n`;
    setDraft((d) => block + d);
  }

  async function submitDraft() {
    const content = draft.trim();
    if (!content) return;
    // Intercept /poll to open the launch modal instead of posting a chat message.
    if (content === "/poll" || content.startsWith("/poll ")) {
      setDraft("");
      setShowPollModal(true);
      return;
    }
    setDraft("");
    await fetch(`/api/room/${id}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    await submitDraft();
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/room/${id}/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Upload failed: ${body.error ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleFile(fileId: string, selected: boolean) {
    await fetch(`/api/room/${id}/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileId, selected }),
    });
  }

  async function generateBrief() {
    setBriefPending(true);
    try {
      await fetch(`/api/room/${id}/brief`, { method: "POST" });
    } catch {
      setBriefPending(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
  }

  if (!joined) {
    return (
      <main style={{ maxWidth: 480, margin: "15vh auto", padding: 24 }}>
        <h1>Join room</h1>
        <p style={{ color: "var(--muted)" }}>Anyone with the link can join. Name and email are for attribution only.</p>
        <form onSubmit={join} style={{ display: "grid", gap: 12 }}>
          <input
            required
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inp()}
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inp()}
          />
          <button
            type="submit"
            disabled={joining || !name.trim() || !email.trim()}
            style={btnPrimary()}
          >
            {joining ? "Joining…" : "Join"}
          </button>
          {joinError && <p style={{ color: "crimson", margin: 0 }}>{joinError}</p>}
        </form>
      </main>
    );
  }

  if (!state) return <main style={{ padding: 24 }}>Connecting…</main>;

  const participantsListNode = (
    <div style={{ padding: isNarrow ? 12 : 0, overflowY: "auto", height: "100%" }}>
      {state.participants.map((p) => (
        <div
          key={p.id}
          style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0" }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 8, background: "#22c55e" }} />
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  );

  const filesPanelNode = (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "1fr auto auto",
        gap: 8,
        minHeight: 0,
        height: "100%",
        padding: isNarrow ? 12 : 0,
      }}
    >
      <div style={{ overflowY: "auto" }}>
        {state.files.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No files yet.</p>
        )}
        {state.files.map((f) => {
          const selected = state.selectedFileIds.includes(f.id);
          const uploader = state.participants.find((p) => p.id === f.uploadedById);
          const uploaderLabel = uploader ? uploader.name : "Unknown uploader";
          const uploadedDate = new Date(f.uploadedAt).toLocaleDateString();
          return (
            <div
              key={f.id}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "6px 0",
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => toggleFile(f.id, e.target.checked)}
                aria-label={`Include ${f.name} in AI context`}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewFileId(f.id);
                    setFilesDrawerOpen(false);
                  }}
                  title={`Preview ${f.name}`}
                  style={{
                    display: "block",
                    width: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    font: "inherit",
                    color: "inherit",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textDecorationColor: "var(--border)",
                    textUnderlineOffset: 3,
                  }}
                >
                  {f.name}
                </button>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={uploader?.email ? `${uploaderLabel} · ${uploader.email}` : uploaderLabel}
                >
                  {uploaderLabel} · {uploadedDate}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <label
        style={{
          ...btnSecondary(),
          textAlign: "center",
          display: "block",
          opacity: busy || state.archived ? 0.5 : 1,
          cursor: state.archived ? "not-allowed" : undefined,
        }}
      >
        {state.archived ? "Upload disabled (archived)" : busy ? "Uploading…" : "+ Upload file"}
        <input
          type="file"
          hidden
          accept=".pdf,.docx,.txt,.md"
          disabled={busy || state.archived}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
      <div>
        <button
          onClick={() => {
            generateBrief();
            setFilesDrawerOpen(false);
          }}
          disabled={briefPending || state.archived}
          style={{
            ...heroBtn(),
            width: "100%",
            opacity: state.archived ? 0.5 : 1,
            cursor: state.archived ? "not-allowed" : undefined,
          }}
        >
          {briefPending ? "Generating…" : "✨ Generate project brief"}
        </button>
        <p
          style={{
            fontSize: 12,
            color: "var(--muted)",
            lineHeight: 1.4,
            margin: "8px 0 0",
          }}
        >
          Turns the conversation and any selected files into a structured brief — themes, outline, risks, next steps, suggested collaborators. Posts to the thread for everyone. Takes ~10–20s.
        </p>
      </div>
    </div>
  );

  return (
    <main
      style={{
        height: "100dvh",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        background: "var(--bg)",
        minHeight: 0,
      }}
    >
      {showPollModal && (
        <PollLaunchModal
          roomId={id}
          onClose={() => setShowPollModal(false)}
          onLaunched={() => setShowPollModal(false)}
        />
      )}
      {catchupOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              maxWidth: 520,
              width: "90%",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
              fontFamily: "system-ui, sans-serif",
              color: "var(--navy)",
            }}
          >
            <h2 style={{ margin: 0, marginBottom: 12, fontFamily: "Montserrat, sans-serif" }}>
              {catchupData?.kind === "orientation"
                ? `Welcome to ${state.name}`
                : "Catch up"}
            </h2>

            {catchupLoading && (
              <p style={{ marginTop: 0 }}>
                Generating summary — please wait a few seconds. The
                <strong> Got it</strong> button will activate once it's ready.
              </p>
            )}

            {!catchupLoading && catchupData?.kind === "orientation" && (
              <>
                <p style={{ marginTop: 0 }}>
                  You're the first one here — no discussion yet.
                </p>
                {catchupData.files.length > 0 && (
                  <>
                    <strong>Files already shared:</strong>
                    <ul>
                      {catchupData.files.map((f) => (
                        <li key={f.id}>{f.name}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p>Go ahead and say hi to kick it off.</p>
              </>
            )}

            {!catchupLoading && catchupData?.kind === "summary" && (
              <>
                <ul style={{ paddingLeft: 20 }}>
                  {catchupData.bullets.map((b, i) => (
                    <li key={i} style={{ marginBottom: 8 }}>
                      {b}
                    </li>
                  ))}
                  {catchupData.bullets.length === 0 && (
                    <li>Nothing notable yet — scroll up to read along.</li>
                  )}
                </ul>
                <PinnedFactsBlock facts={catchupData.pinnedFacts} />
              </>
            )}

            {!catchupLoading && catchupData?.kind === "error" && (
              <p>Couldn't generate a summary — scroll up to see the conversation.</p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                onClick={() => setCatchupOpen(false)}
                disabled={catchupLoading}
                style={{
                  ...btnSecondary(),
                  opacity: catchupLoading ? 0.5 : 1,
                  cursor: catchupLoading ? "not-allowed" : "pointer",
                }}
              >
                {catchupLoading ? "Waiting for summary…" : "Got it"}
              </button>
            </div>
          </div>
        </div>
      )}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: 8,
          padding: isNarrow ? "10px 12px" : "12px 20px",
          background: "var(--navy)",
          color: "white",
          position: "relative",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 160px" }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>MindForum</div>
          <div
            style={{
              fontFamily: "Montserrat, sans-serif",
              fontSize: isNarrow ? 17 : 20,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {state.name}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            position: "relative",
            flexWrap: "wrap",
          }}
        >
          {isNarrow && (
            <>
              <button
                type="button"
                onClick={() => setParticipantsDrawerOpen(true)}
                aria-label={`Show participants (${state.participants.length})`}
                style={{
                  ...btnSecondary(),
                  background: "rgba(255,255,255,0.12)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span aria-hidden="true">👥</span>
                <span>{state.participants.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setFilesDrawerOpen(true)}
                aria-label={`Show files (${state.files.length})`}
                style={{
                  ...btnSecondary(),
                  background: "rgba(255,255,255,0.12)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span aria-hidden="true">📁</span>
                <span>{state.files.length}</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Notification settings"
            aria-expanded={settingsOpen}
            title="Notification settings"
            style={{
              ...btnSecondary(),
              background: "rgba(255,255,255,0.12)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>Alerts</span>
            {unread > 0 && (
              <span
                style={{
                  background: "var(--orange)",
                  color: "white",
                  borderRadius: 999,
                  padding: "1px 7px",
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1.4,
                }}
              >
                {unread}
              </span>
            )}
          </button>
          <button onClick={copyLink} style={{ ...btnSecondary(), background: "var(--orange)" }}>
            Copy link
          </button>
          {settingsOpen && (
            <NotifySettingsPopover
              prefs={prefs}
              perm={perm}
              onChange={updatePref}
              onEnable={enableBrowserNotifications}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      </header>

      {state.archived && (
        <div
          role="status"
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            borderBottom: "1px solid #fecaca",
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 500,
            textAlign: "center",
          }}
        >
          This room is archived — read-only. Restore it from the room settings to reopen.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "220px 1fr 280px",
          gap: isNarrow ? 8 : 16,
          padding: isNarrow ? 8 : 16,
          minHeight: 0,
        }}
      >
        {!isNarrow && (
          <aside style={{ ...col(), display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
            <h3 style={colTitle()}>Participants</h3>
            {participantsListNode}
          </aside>
        )}

        <section
          style={{ ...col(), minHeight: 0, display: "grid", gridTemplateRows: "1fr auto" }}
        >
          <div style={{ overflowY: "auto", paddingRight: 8 }}>
            {state.systemPrompt && <GuidanceCard text={state.systemPrompt} />}
            {state.messages.length === 0 && (
              <p style={{ color: "var(--muted)" }}>
                Mention <code>@ai</code> to ask a question, or click <b>Generate project brief</b> when the room has enough context.
              </p>
            )}
            {(() => {
              type StreamItem =
                | { kind: "msg"; at: number; data: Msg }
                | { kind: "poll"; at: number; data: OpenPoll | ClosedPoll };
              const items: StreamItem[] = [
                ...state.messages.map((m) => ({ kind: "msg" as const, at: m.createdAt, data: m })),
                ...(state.openPolls ?? []).map((p) => ({
                  kind: "poll" as const,
                  at: p.createdAt,
                  data: p,
                })),
                ...(state.recentClosedPolls ?? []).map((p) => ({
                  kind: "poll" as const,
                  at: p.createdAt,
                  data: p,
                })),
              ];
              items.sort((a, b) => a.at - b.at);
              return items.map((it) =>
                it.kind === "msg" ? (
                  <MsgView
                    key={it.data.id}
                    m={it.data}
                    roomId={id}
                    viewerId={participantId}
                    onQuote={quoteReply}
                  />
                ) : (
                  <PollCard
                    key={it.data.id}
                    poll={it.data}
                    currentParticipantId={participantId}
                    isAdmin={false}
                  />
                ),
              );
            })()}
            {briefPending && (
              <div style={{ color: "var(--muted)", fontStyle: "italic", padding: "8px 0" }}>
                Generating brief…
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          {state.archived ? (
            <div
              style={{
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
                color: "var(--muted)",
                fontSize: 13,
                fontStyle: "italic",
              }}
            >
              Composer disabled — this room is archived.
            </div>
          ) : (() => {
            const aiMention = /^\s*@ai\b/i.test(draft);
            const pollCommand = /^\/poll(\s|$)/.test(draft);
            const pills = detectMentionPills(draft, state.participants, participantId);
            return (
              <form
                onSubmit={send}
                style={{
                  display: "grid",
                  gap: 6,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border)",
                }}
              >
                {pills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {pills.map((p, i) => (
                      <MentionPill key={`${p.kind}-${p.label}-${i}`} pill={p} />
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
                    <div
                      aria-hidden="true"
                      style={{
                        ...inp(),
                        flex: undefined,
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflow: "hidden",
                        borderColor: "transparent",
                        background: "transparent",
                        color: "var(--text)",
                        lineHeight: 1.4,
                      }}
                    >
                      {renderInputMentions(draft)}
                    </div>
                    <TextareaAutosize
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          void submitDraft();
                        }
                      }}
                      placeholder="Type a message. Start with @ai to ask the AI. (Shift+Enter for newline)"
                      minRows={1}
                      maxRows={8}
                      style={{
                        ...inp(),
                        width: "100%",
                        display: "block",
                        borderColor: aiMention
                          ? "var(--orange)"
                          : pollCommand
                            ? "var(--navy)"
                            : "var(--border)",
                        boxShadow: aiMention
                          ? "0 0 0 3px rgba(232,74,39,0.15)"
                          : pollCommand
                            ? "0 0 0 3px rgba(19,41,75,0.15)"
                            : "none",
                        outline: "none",
                        transition: "border-color 120ms, box-shadow 120ms",
                        background: "transparent",
                        color: draft ? "transparent" : undefined,
                        caretColor: "var(--text)",
                        position: "relative",
                        resize: "none",
                        fontFamily: "inherit",
                        lineHeight: 1.4,
                        overflowY: "auto",
                      } as React.ComponentProps<typeof TextareaAutosize>["style"]}
                    />
                  </div>
                  <button type="submit" style={btnPrimary()}>
                    Send
                  </button>
                </div>
              </form>
            );
          })()}
        </section>

        {!isNarrow && (
          <aside
            style={{
              ...col(),
              display: "grid",
              gridTemplateRows: "auto 1fr",
              gap: 8,
              minHeight: 0,
            }}
          >
            <h3 style={colTitle()}>Files</h3>
            {filesPanelNode}
          </aside>
        )}
      </div>
      {isNarrow && participantsDrawerOpen && (
        <Drawer
          side="left"
          title={`Participants (${state.participants.length})`}
          onClose={() => setParticipantsDrawerOpen(false)}
        >
          {participantsListNode}
        </Drawer>
      )}
      {isNarrow && filesDrawerOpen && (
        <Drawer
          side="right"
          title={`Files (${state.files.length})`}
          onClose={() => setFilesDrawerOpen(false)}
        >
          {filesPanelNode}
        </Drawer>
      )}
      {previewFileId && (
        <FilePreviewModal
          loading={previewLoading}
          error={previewError}
          data={previewData}
          onClose={() => setPreviewFileId(null)}
        />
      )}
    </main>
  );
}

function useIsNarrow(breakpoint = 720): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return narrow;
}

function Drawer({
  side,
  title,
  onClose,
  children,
}: {
  side: "left" | "right";
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        flexDirection: side === "left" ? "row" : "row-reverse",
      }}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }}
      />
      <div
        style={{
          position: "relative",
          background: "var(--card)",
          width: "min(86vw, 320px)",
          height: "100%",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          boxShadow:
            side === "left"
              ? "2px 0 16px rgba(0,0,0,0.25)"
              : "-2px 0 16px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontFamily: "Montserrat, sans-serif",
              color: "var(--navy)",
            }}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 24,
              lineHeight: 1,
              color: "var(--muted)",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ minHeight: 0, overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}

function FilePreviewModal({
  loading,
  error,
  data,
  onClose,
}: {
  loading: boolean;
  error: string | null;
  data: FilePreview | null;
  onClose: () => void;
}) {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 600;
  const ext = data ? data.name.toLowerCase().split(".").pop() ?? "" : "";
  const isMd = ext === "md" || ext === "markdown";
  const isTxt = ext === "txt";
  const showExtractedBanner = !!data && !isMd && !isTxt;

  const titleId = "file-preview-title";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "center",
        zIndex: 60,
        padding: isMobile ? 0 : 24,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: isMobile ? 0 : 12,
          width: isMobile ? "100%" : "min(800px, 100%)",
          maxHeight: isMobile ? "100%" : "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              id={titleId}
              style={{
                fontWeight: 600,
                fontSize: 16,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={data?.name}
            >
              {data?.name ?? (loading ? "Loading…" : "File")}
            </div>
            {data && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {Math.max(1, Math.round(data.sizeBytes / 1024))} KB
                {" · Uploaded by "}
                {data.uploaderName ?? "Unknown"}
                {data.uploaderEmail ? ` (${data.uploaderEmail})` : ""}
                {" · "}
                {new Date(data.uploadedAt).toLocaleString()}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
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
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            fontSize: 14,
          }}
        >
          {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
          {error && (
            <p style={{ color: "#b91c1c" }}>
              Couldn&apos;t load this file: {error}
            </p>
          )}
          {data && showExtractedBanner && (
            <div
              style={{
                background: "#fef3c7",
                border: "1px solid #fcd34d",
                borderRadius: 6,
                padding: "8px 12px",
                marginBottom: 12,
                fontSize: 13,
                color: "#78350f",
              }}
            >
              This is the text the AI extracted from the original file. Formatting may differ from the source.
            </div>
          )}
          {data && isMd && (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {data.extractedText || "_(empty)_"}
            </ReactMarkdown>
          )}
          {data && !isMd && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 13,
                margin: 0,
              }}
            >
              {data.extractedText || "(empty)"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function GuidanceCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.length > 140 ? text.slice(0, 140) + "…" : text;
  return (
    <div
      style={{
        padding: "10px 12px",
        margin: "0 0 12px",
        background: "rgba(19,41,75,0.04)",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      <div style={{ color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
        AI guidance for this room
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{open ? text : preview}</div>
      {text.length > 140 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            marginTop: 4,
            background: "transparent",
            border: "none",
            color: "var(--navy)",
            fontWeight: 600,
            padding: 0,
            fontSize: 12,
          }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function MsgView({
  m,
  roomId,
  viewerId,
  onQuote,
}: {
  m: Msg;
  roomId?: string;
  viewerId?: string;
  onQuote?: (m: Msg) => void;
}) {
  if (m.kind === "brief") return <BriefView m={m} />;
  const isAi = m.authorId === "ai";

  const [hover, setHover] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState("");

  const canInteract = Boolean(roomId && viewerId && m.content);
  const isMine = !isAi && viewerId !== undefined && viewerId !== "" && m.authorId === viewerId;
  const canEdit = Boolean(isMine && roomId && m.content);

  async function react(emoji: string) {
    if (!roomId || !viewerId) return;
    setPickerOpen(false);
    try {
      await fetch(`/api/room/${roomId}/message/${m.id}/react`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
    } catch {
      /* SSE will eventually reconcile */
    }
  }

  function startEdit() {
    setEditDraft(m.content);
    setEditErr("");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditDraft("");
    setEditErr("");
  }

  async function saveEdit() {
    const next = editDraft.trim();
    if (!next || !roomId) return;
    if (next === m.content) {
      cancelEdit();
      return;
    }
    setEditBusy(true);
    setEditErr("");
    try {
      const res = await fetch(`/api/room/${roomId}/message/${m.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: next }),
      });
      if (!res.ok) {
        setEditErr(res.status === 403 ? "You can only edit your own messages." : "Edit failed.");
        return;
      }
      setEditing(false);
      setEditDraft("");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPickerOpen(false);
      }}
      style={{
        position: "relative",
        padding: "10px 12px",
        margin: "8px 0",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        borderLeft: isAi ? "3px solid var(--orange)" : "3px solid var(--navy)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{m.authorName}</span>
        <span
          style={{ marginLeft: 6 }}
          title={new Date(m.createdAt).toLocaleString()}
        >
          {formatMsgTime(m.createdAt)}
        </span>
        {m.editedAt ? (
          <span
            style={{ marginLeft: 6, fontSize: 11, fontStyle: "italic" }}
            title={`Edited ${new Date(m.editedAt).toLocaleString()}`}
          >
            (edited)
          </span>
        ) : null}
      </div>

      {editing ? (
        <div style={{ display: "grid", gap: 6 }}>
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={Math.min(8, Math.max(2, editDraft.split("\n").length))}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void saveEdit();
              }
            }}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              fontFamily: "inherit",
              fontSize: 14,
              resize: "vertical",
            }}
          />
          {editErr && (
            <div style={{ color: "crimson", fontSize: 12 }}>{editErr}</div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={saveEdit}
              disabled={editBusy || !editDraft.trim()}
              style={{
                ...btnPrimary(),
                padding: "6px 12px",
                fontSize: 13,
                opacity: editBusy ? 0.6 : 1,
              }}
            >
              {editBusy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={editBusy}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 13,
              }}
            >
              Cancel
            </button>
            <span style={{ color: "var(--muted)", fontSize: 11, alignSelf: "center" }}>
              ⌘/Ctrl+Enter to save · Esc to cancel
            </span>
          </div>
        </div>
      ) : (
        <div
          style={
            isAi
              ? { /* markdown handles whitespace */ }
              : { whiteSpace: "pre-wrap" }
          }
          className={isAi ? "msg-md" : undefined}
        >
          {m.content ? (
            isAi ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={mdComponents}
              >
                {m.content}
              </ReactMarkdown>
            ) : (
              renderWithMentions(m.content)
            )
          ) : isAi ? (
            <span style={{ color: "var(--muted)", fontStyle: "italic" }}>thinking…</span>
          ) : null}
        </div>
      )}

      {!editing && m.reactions && m.reactions.length > 0 && (
        <ReactionChips reactions={m.reactions} viewerId={viewerId ?? ""} onToggle={react} />
      )}

      {hover && !editing && canInteract && (
        <MessageToolbar
          onReact={react}
          onQuote={onQuote ? () => onQuote(m) : undefined}
          onEdit={canEdit ? startEdit : undefined}
          pickerOpen={pickerOpen}
          togglePicker={() => setPickerOpen((o) => !o)}
        />
      )}
    </div>
  );
}

const QUICK_REACTIONS = ["👍", "❤️", "😆", "😮"];
const PICKER_EMOJIS = [
  "👍", "❤️", "😆", "😮", "🎉",
  "🔥", "🚀", "👏", "💡", "✅",
  "❌", "❓", "🤔", "🙏", "⭐",
  "😊", "😢", "😡", "👀", "🙌",
];

function MessageToolbar({
  onReact,
  onQuote,
  onEdit,
  pickerOpen,
  togglePicker,
}: {
  onReact: (emoji: string) => void;
  onQuote?: () => void;
  onEdit?: () => void;
  pickerOpen: boolean;
  togglePicker: () => void;
}) {
  const btn: React.CSSProperties = {
    background: "transparent",
    border: "none",
    padding: "4px 6px",
    fontSize: 16,
    lineHeight: 1,
    borderRadius: 4,
    color: "var(--text)",
  };
  return (
    <div
      style={{
        position: "absolute",
        top: -16,
        right: 12,
        display: "flex",
        alignItems: "center",
        gap: 2,
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "2px 4px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        zIndex: 5,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onReact(e)}
          style={btn}
          aria-label={`React with ${e}`}
          title={`React with ${e}`}
        >
          {e}
        </button>
      ))}
      {onEdit ? (
        // Own messages: the prominent middle slot is the edit pencil
        // (you don't typically need the picker on your own message).
        <button
          type="button"
          onClick={onEdit}
          style={{ ...btn, fontSize: 16 }}
          aria-label="Edit message"
          title="Edit message"
        >
          ✏️
        </button>
      ) : (
        // Others' messages: keep the "more reactions" picker in this slot.
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={togglePicker}
            style={{ ...btn, fontSize: 14, fontWeight: 700 }}
            aria-label="More reactions"
            title="More reactions"
            aria-expanded={pickerOpen}
          >
            +
          </button>
          {pickerOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 6,
                boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                display: "grid",
                gridTemplateColumns: "repeat(5, 28px)",
                gap: 2,
                zIndex: 6,
              }}
            >
              {PICKER_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onReact(e)}
                  style={{ ...btn, padding: 4 }}
                  aria-label={`React with ${e}`}
                  title={`React with ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onQuote && (
        <button
          type="button"
          onClick={onQuote}
          style={{ ...btn, fontSize: 14, color: "var(--muted)" }}
          aria-label="Quote reply"
          title="Quote reply"
        >
          ❝
        </button>
      )}
    </div>
  );
}

function ReactionChips({
  reactions,
  viewerId,
  onToggle,
}: {
  reactions: Reaction[];
  viewerId: string;
  onToggle: (emoji: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        marginTop: 6,
      }}
    >
      {reactions.map((r) => {
        const mine = viewerId !== "" && r.reacterIds.includes(viewerId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle(r.emoji)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "1px 8px",
              borderRadius: 999,
              fontSize: 12,
              lineHeight: "20px",
              border: `1px solid ${mine ? "var(--navy)" : "var(--border)"}`,
              background: mine ? "rgba(19,41,75,0.08)" : "var(--card)",
              color: "var(--text)",
              cursor: "pointer",
            }}
            aria-pressed={mine}
            title={mine ? "Remove your reaction" : "Add your reaction"}
          >
            <span>{r.emoji}</span>
            <span style={{ fontWeight: 600, fontSize: 11 }}>{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p style={{ margin: "0 0 8px" }}>{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul style={{ margin: "0 0 8px", paddingLeft: 22 }}>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol style={{ margin: "0 0 8px", paddingLeft: 22 }}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li style={{ margin: "2px 0" }}>{children}</li>
  ),
  code: ({
    inline,
    children,
  }: {
    inline?: boolean;
    children?: React.ReactNode;
  }) =>
    inline === false ? (
      <code>{children}</code>
    ) : (
      <code
        style={{
          background: "var(--border)",
          padding: "1px 5px",
          borderRadius: 3,
          fontSize: "0.92em",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {children}
      </code>
    ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre
      style={{
        background: "var(--border)",
        padding: 10,
        borderRadius: 6,
        overflowX: "auto",
        margin: "0 0 8px",
        fontSize: "0.9em",
      }}
    >
      {children}
    </pre>
  ),
  a: ({
    href,
    children,
  }: {
    href?: string;
    children?: React.ReactNode;
  }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--orange)", textDecoration: "underline" }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote
      style={{
        borderLeft: "3px solid var(--border)",
        paddingLeft: 10,
        margin: "0 0 8px",
        color: "var(--muted)",
      }}
    >
      {children}
    </blockquote>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 style={{ margin: "10px 0 6px", fontSize: "1.05em" }}>{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h3 style={{ margin: "10px 0 6px", fontSize: "1.05em" }}>{children}</h3>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h4 style={{ margin: "8px 0 4px", fontSize: "1em" }}>{children}</h4>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <table
      style={{
        borderCollapse: "collapse",
        margin: "0 0 8px",
        fontSize: "0.95em",
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th
      style={{
        border: "1px solid var(--border)",
        padding: "4px 8px",
        textAlign: "left",
        background: "var(--card)",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td style={{ border: "1px solid var(--border)", padding: "4px 8px" }}>
      {children}
    </td>
  ),
};

type Pill = { kind: "ai" | "all" | "user"; label: string };

function escapeRegexLocal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameTokensLocal(fullName: string): string[] {
  const trimmed = fullName.trim();
  if (!trimmed) return [];
  const out = new Set<string>([trimmed]);
  const firstRaw = trimmed.split(/\s+/)[0] ?? "";
  const first = firstRaw.replace(/[.,;:!?]+$/, "");
  if (first && first !== trimmed && first.length >= 2) out.add(first);
  return [...out];
}

/**
 * Build the set of "X will be notified" pills shown above the message input.
 * Skips the viewer themselves; dedupes per participant; matches @ai / @all /
 * @everyone with their own pill kinds.
 */
function detectMentionPills(
  draft: string,
  participants: Participant[],
  viewerId: string
): Pill[] {
  if (!draft) return [];
  const pills: Pill[] = [];
  if (/^\s*@ai\b/i.test(draft)) {
    pills.push({ kind: "ai", label: "AI will respond" });
  }
  if (/@(all|everyone)\b/i.test(draft)) {
    pills.push({ kind: "all", label: "Everyone will be notified" });
  }
  const seen = new Set<string>();
  for (const p of participants) {
    if (p.id === viewerId) continue;
    if (seen.has(p.id)) continue;
    for (const tok of nameTokensLocal(p.name)) {
      if (new RegExp(`@${escapeRegexLocal(tok)}\\b`, "i").test(draft)) {
        pills.push({ kind: "user", label: `${p.name} will be notified` });
        seen.add(p.id);
        break;
      }
    }
  }
  return pills;
}

function MentionPill({ pill }: { pill: Pill }) {
  const bg = pill.kind === "ai" ? "var(--orange)" : "var(--navy)";
  return (
    <div
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        alignItems: "center",
        gap: 6,
        background: bg,
        color: "white",
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 8px",
        borderRadius: 999,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 6, background: "white" }} />
      {pill.label}
    </div>
  );
}

// Color-only mention rendering for the live input mirror — no padding/background
// so glyph widths stay aligned with the underlying transparent <input>.
function renderInputMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let i = 0;

  // Leading /poll command — recognized only at the very start, same rule as the intercept.
  const pollMatch = text.match(/^\/poll(?=\s|$)/);
  if (pollMatch) {
    parts.push(
      <span key={`im-${i++}`} style={{ color: "var(--navy)", fontWeight: 600 }}>
        {pollMatch[0]}
      </span>,
    );
    cursor = pollMatch[0].length;
  }

  const regex = /@[\w-]+/g;
  regex.lastIndex = cursor;
  let last = cursor;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const isAi = /^@ai$/i.test(match[0]);
    parts.push(
      <span
        key={`im-${i++}`}
        style={{ color: isAi ? "var(--orange)" : "var(--navy)", fontWeight: 600 }}
      >
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderWithMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /@[\w-]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const isAi = /^@ai$/i.test(match[0]);
    parts.push(
      <span
        key={`m-${i++}`}
        style={{
          background: isAi ? "var(--orange)" : "var(--navy)",
          color: "white",
          padding: "1px 6px",
          borderRadius: 4,
          fontWeight: 600,
          fontSize: "0.92em",
        }}
      >
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type BriefDecisionData = {
  question: string;
  closedAt: string;
  winnerText: string | null;
  tallies: { option: string; votes: number }[];
  totalVotes: number;
  inconclusive: boolean;
};

type BriefData = {
  themes?: string[];
  outline?: { section: string; points: string[] }[];
  risks?: string[];
  nextSteps?: string[];
  suggestedCollaborators?: string[];
  decisions?: BriefDecisionData[];
};

function briefToMarkdown(brief: BriefData, createdAt: number): string {
  const iso = new Date(createdAt).toISOString().slice(0, 19).replace("T", " ");
  const lines: string[] = [`# Project Brief`, ``, `_Generated ${iso} UTC_`, ``];
  if (brief.themes?.length) {
    lines.push(`## Themes`, ``);
    for (const t of brief.themes) lines.push(`- ${t}`);
    lines.push(``);
  }
  if (brief.outline?.length) {
    lines.push(`## Outline`, ``);
    for (const o of brief.outline) {
      lines.push(`### ${o.section}`, ``);
      for (const p of o.points ?? []) lines.push(`- ${p}`);
      lines.push(``);
    }
  }
  if (brief.risks?.length) {
    lines.push(`## Risks`, ``);
    for (const r of brief.risks) lines.push(`- ${r}`);
    lines.push(``);
  }
  if (brief.decisions?.length) {
    lines.push(`## Decisions & Votes`, ``);
    for (const d of brief.decisions) {
      const date = new Date(d.closedAt).toISOString().slice(0, 10);
      const inc = d.inconclusive ? ` (inconclusive)` : ``;
      lines.push(`### ${d.question}`, ``);
      lines.push(`_Closed ${date} · ${d.totalVotes} ${d.totalVotes === 1 ? "vote" : "votes"}${inc}_`, ``);
      for (const t of d.tallies) {
        const isWinner = t.option === d.winnerText;
        const label = isWinner ? `**${t.option}**` : t.option;
        const suffix = isWinner ? ` (winner)` : ``;
        lines.push(`- ${label} — ${t.votes} ${t.votes === 1 ? "vote" : "votes"}${suffix}`);
      }
      lines.push(``);
    }
  }
  if (brief.nextSteps?.length) {
    lines.push(`## Next steps`, ``);
    for (const n of brief.nextSteps) lines.push(`- ${n}`);
    lines.push(``);
  }
  if (brief.suggestedCollaborators?.length) {
    lines.push(`## Suggested collaborators`, ``);
    for (const c of brief.suggestedCollaborators) lines.push(`- ${c}`);
    lines.push(``);
  }
  return lines.join("\n");
}

function BriefView({ m }: { m: Msg }) {
  let brief: BriefData | null = null;
  try {
    brief = JSON.parse(m.content);
  } catch {
    return <MsgView m={{ ...m, kind: "chat", content: m.content }} />;
  }
  const download = () => {
    if (!brief) return;
    const md = briefToMarkdown(brief, m.createdAt);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date(m.createdAt).toISOString().slice(0, 10);
    a.href = url;
    a.download = `mindforum-brief-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <div
      style={{
        padding: 16,
        margin: "12px 0",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        borderLeft: "3px solid var(--orange)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontFamily: "Montserrat, sans-serif",
            color: "var(--navy)",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          Project Brief
        </div>
        <button
          type="button"
          onClick={download}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--navy)",
            fontWeight: 600,
          }}
        >
          ↓ Download .md
        </button>
      </div>
      <Section title="Themes" items={brief?.themes} />
      {brief?.outline && brief.outline.length > 0 && (
        <div style={{ margin: "12px 0" }}>
          <div style={sectionTitle()}>Outline</div>
          {brief.outline.map((o, i) => (
            <div key={i} style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600 }}>{o.section}</div>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {(o.points ?? []).map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Section title="Risks" items={brief?.risks} />
      {brief?.decisions && brief.decisions.length > 0 && (
        <div style={{ margin: "12px 0" }}>
          <div style={sectionTitle()}>Decisions & Votes</div>
          {brief.decisions.map((d, i) => (
            <div key={i} style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600 }}>{d.question}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Closed {new Date(d.closedAt).toLocaleDateString()} · {d.totalVotes}{" "}
                {d.totalVotes === 1 ? "vote" : "votes"}
                {d.inconclusive && <span> (inconclusive)</span>}
              </div>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {d.tallies.map((t, j) => {
                  const isWinner = t.option === d.winnerText;
                  return (
                    <li key={j} style={isWinner ? { fontWeight: 600 } : undefined}>
                      {t.option} — {t.votes} {t.votes === 1 ? "vote" : "votes"}
                      {isWinner && " (winner)"}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Section title="Next steps" items={brief?.nextSteps} />
      <Section title="Suggested collaborators" items={brief?.suggestedCollaborators} />
    </div>
  );
}

function Section({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div style={{ margin: "12px 0" }}>
      <div style={sectionTitle()}>{title}</div>
      <ul style={{ margin: "4px 0 0 18px" }}>
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function sectionTitle(): React.CSSProperties {
  return { fontFamily: "Montserrat, sans-serif", color: "var(--navy)", fontWeight: 600 };
}
function col(): React.CSSProperties {
  return {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 16,
    overflow: "hidden",
  };
}
function colTitle(): React.CSSProperties {
  return {
    margin: "0 0 8px",
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--muted)",
  };
}
function inp(): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    fontSize: 16,
  };
}
function btnPrimary(): React.CSSProperties {
  return {
    background: "var(--orange)",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontWeight: 600,
  };
}
function btnSecondary(): React.CSSProperties {
  return {
    background: "var(--navy)",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontWeight: 600,
  };
}
function heroBtn(): React.CSSProperties {
  return {
    background: "linear-gradient(135deg, var(--orange), #ff7a3d)",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "12px 16px",
    fontWeight: 700,
    fontSize: 15,
  };
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const idx = arr.findIndex((a) => a.id === item.id);
  if (idx === -1) return [...arr, item];
  const copy = arr.slice();
  copy[idx] = item;
  return copy;
}

function PinnedFactsBlock({
  facts,
}: {
  facts: { names: string[]; decisions: string[]; files: string[] };
}) {
  const hasAny =
    facts.names.length > 0 || facts.decisions.length > 0 || facts.files.length > 0;
  if (!hasAny) return null;
  const row = (label: string, items: string[]) =>
    items.length === 0 ? null : (
      <div style={{ marginTop: 6, fontSize: 13 }}>
        <span style={{ color: "var(--muted)", fontWeight: 600 }}>{label}: </span>
        {items.join(", ")}
      </div>
    );
  return (
    <div
      style={{
        marginTop: 14,
        padding: "10px 12px",
        background: "rgba(19,41,75,0.04)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--muted)",
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        Key references
      </div>
      {row("People", facts.names)}
      {row("Decisions", facts.decisions)}
      {row("Files", facts.files)}
    </div>
  );
}

function snippet(s: string, max = 140): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/**
 * Render a chat timestamp in the same shorthand pattern as Slack/Discord:
 *  - same calendar day → "3:45 PM"
 *  - prior calendar day → "Yesterday 3:45 PM"
 *  - same year         → "Apr 28, 3:45 PM"
 *  - older             → "Apr 28, 2025"
 * Full date stays available via the parent element's `title` attribute.
 */
function formatMsgTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  if (isYesterday) return `Yesterday ${time}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function NotifySettingsPopover({
  prefs,
  perm,
  onChange,
  onEnable,
  onClose,
}: {
  prefs: NotifyPrefs;
  perm: NotificationPermission | "unsupported";
  onChange: <K extends keyof NotifyPrefs>(key: K, value: NotifyPrefs[K]) => void;
  onEnable: () => void;
  onClose: () => void;
}) {
  // Close on outside click.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    fontSize: 14,
    color: "var(--navy)",
    cursor: "pointer",
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        zIndex: 40,
        minWidth: 280,
        background: "white",
        color: "var(--navy)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        padding: 14,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Notifications</div>

      {perm === "unsupported" && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Browser notifications aren&apos;t supported here. Sound and tab-title alerts still work.
        </p>
      )}
      {perm === "default" && (
        <button
          type="button"
          onClick={onEnable}
          style={{
            ...btnSecondary(),
            background: "var(--orange)",
            width: "100%",
            marginBottom: 8,
            padding: "8px 12px",
            fontSize: 13,
          }}
        >
          Enable browser notifications
        </button>
      )}
      {perm === "denied" && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Browser notifications are blocked for this site. Update your browser&apos;s site
          settings to allow them.
        </p>
      )}

      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.toast}
          disabled={perm === "unsupported" || perm === "denied"}
          onChange={(e) => onChange("toast", e.target.checked)}
        />
        <span>Browser notification on @mention</span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.sound}
          onChange={(e) => onChange("sound", e.target.checked)}
        />
        <span>Sound on @mention</span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.mentionAll}
          onChange={(e) => onChange("mentionAll", e.target.checked)}
        />
        <span>Notify on @all / @everyone</span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.aiReplies}
          onChange={(e) => onChange("aiReplies", e.target.checked)}
        />
        <span>Notify when AI replies to me</span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          checked={prefs.reactions}
          onChange={(e) => onChange("reactions", e.target.checked)}
        />
        <span>Notify on reactions to my messages</span>
      </label>

      <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0", lineHeight: 1.4 }}>
        Alerts only fire when this tab is unfocused. The tab title shows an unread count
        until you come back.
      </p>
    </div>
  );
}
