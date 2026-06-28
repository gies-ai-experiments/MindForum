export type TourStep = {
  /** A unique CSS selector, e.g. '[data-tour="composer"]'. */
  selector: string;
  title: string;
  /** Allows simple inline HTML (e.g. <strong>). */
  body: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Optional stable id so a host page can attach show/hide side-effects to this step. */
  id?: string;
};

export const ROOM_TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="composer"]',
    title: "Talk to the room — and the AI",
    body: "Type to brainstorm with everyone here. Start a message with <strong>@ai</strong> to pull in the AI — it stays silent until you mention it.",
    side: "top",
  },
  {
    selector: '[data-tour="attach"]',
    title: "Give the AI context",
    body: "Share PDFs, Word docs, or links — or scrape a URL, pull in a GitHub repo, or <strong>paste raw text</strong>. The AI reads the sources you select before it answers.",
    side: "bottom",
  },
  {
    selector: '[data-tour="composer"]',
    title: "Put it to a vote",
    body: "Type <strong>/poll</strong> to ask the group a question. Tallies stay hidden until the poll closes.",
    side: "top",
    id: "poll",
  },
  {
    selector: '[data-tour="composer"]',
    title: "Summarize anything",
    body: "Type <strong>/summarize</strong> to summarize the room discussion or your own pasted text, then download it as Markdown or PDF.",
    side: "top",
    id: "summarize",
  },
  {
    selector: '[data-tour="thread"]',
    title: "Edit or delete your messages",
    body: "Hover any message <strong>you</strong> sent to edit or delete it. A deleted message leaves a small placeholder so the rest of the thread still reads in order.",
    side: "left",
    align: "start",
  },
  {
    selector: '[data-tour="brief"]',
    title: "Wrap it into a brief",
    body: "When you're done, turn the whole thread into themes, risks, and next steps — downloadable as Markdown.",
    side: "left",
  },
  {
    selector: '[data-tour="participants"]',
    title: "See who's here",
    body: "Check who's in the room — a <strong>green dot</strong> marks who's online right now — and @-mention a colleague to flag something for them.",
    side: "left",
  },
  {
    selector: '[data-tour="room-settings"]',
    title: "Set up the room",
    body: "Managers: open <strong>⚙ Settings</strong> to rename the room, edit the AI's instructions (or auto-generate them), and switch on <strong>web search</strong> so the AI can cite live sources when someone asks.",
    side: "bottom",
    align: "end",
  },
];

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="stats"]',
    title: "Your rooms at a glance",
    body: "Live totals across all your rooms — recent activity, participants, and shared files.",
    side: "bottom",
  },
  {
    selector: '[data-tour="create"]',
    title: "Create a room",
    body: "Name it, brief the AI on how to behave, and attach context files — all in one step.",
    side: "top",
  },
  {
    selector: '[data-tour="rooms"]',
    title: "Manage your rooms",
    body: "Open any room or jump to its settings. Use the tabs to filter Active vs. Archived, and the per-row actions to <strong>archive, restore, or permanently delete</strong> a room.",
    side: "top",
  },
  {
    selector: '[data-tour="ranking"]',
    title: "Where the energy is",
    body: "Your most active rooms over the last 7 days.",
    side: "left",
  },
  {
    selector: '[data-tour="api-keys"]',
    title: "Build on the API",
    body: "Mint a personal <strong>API key</strong> to create rooms and send invitations programmatically. Keys are shown once — copy it then, and revoke it anytime.",
    side: "top",
  },
];

// Bumped v1 → v2 (2026-06-27) when the tour gained steps for the API keys
// panel, message edit/delete, participant presence, and room web search — so
// users who already dismissed v1 re-see the refreshed walkthrough once.
export const TOUR_KEYS = {
  room: "mindforum_tour_room_v2",
  dashboard: "mindforum_tour_dash_v2",
} as const;

// ---- Pure, DOM-independent helpers (deps injected → unit-testable) ----

/** Keep steps (in original order) whose target passes the visibility predicate. */
export function selectVisibleSteps(
  steps: TourStep[],
  isVisible: (selector: string) => boolean
): TourStep[] {
  return steps.filter((s) => isVisible(s.selector));
}

export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function tourSeen(key: string, store: KVStore): boolean {
  return store.getItem(key) === "1";
}

export function markTourSeen(key: string, store: KVStore): void {
  store.setItem(key, "1");
}
