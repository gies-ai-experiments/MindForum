// "What's new" — a feature walkthrough of changes shipped since the user's last
// visit. It reuses the tour mechanism (driver.js spotlight + popovers): each
// entry is a tour-shaped step pointing at the real UI, plus a stable `id`. The
// lists are CHRONOLOGICAL (oldest → newest); the last-seen step id is stored in
// localStorage per surface, and everything AFTER it is "new". Mirrors the
// pattern in lib/tour-steps.ts. Keep these in step with ROOM/DASHBOARD selectors.

import type { TourStep, KVStore } from "./tour-steps";

export type WhatsNewStep = TourStep & { id: string };

// Room features, oldest → newest. Append new entries at the END.
export const WHATS_NEW_ROOM: WhatsNewStep[] = [
  {
    id: "room-settings",
    selector: '[data-tour="room-settings"]',
    title: "In-room manager settings",
    body: "Managers can open <strong>⚙ Settings</strong> right here to rename the room and edit the AI's instructions (or auto-generate them).",
    side: "bottom",
    align: "end",
  },
  {
    id: "web-search",
    selector: '[data-tour="room-settings"]',
    title: "AI web search",
    body: "Flip on <strong>web search</strong> in ⚙ Settings so the AI can cite live sources when someone asks.",
    side: "bottom",
    align: "end",
  },
  {
    id: "presence",
    selector: '[data-tour="participants"]',
    title: "See who's online",
    body: "A <strong>green dot</strong> in the participants list now shows who's in the room right now.",
    side: "left",
  },
  {
    id: "message-edit-delete",
    selector: '[data-tour="thread"]',
    title: "Edit & delete your messages",
    body: "Hover any message <strong>you</strong> sent to edit or delete it. A deleted message leaves a small placeholder so the thread still reads in order.",
    side: "left",
    align: "start",
  },
  {
    id: "summary-export",
    selector: '[data-tour="composer"]',
    title: "Export a summary to another room",
    body: "Run <strong>/summarize</strong>, then drop the result into another room you're in as a context file.",
    side: "top",
  },
  {
    id: "slash-menu",
    selector: '[data-tour="composer"]',
    title: "Slash-command menu",
    body: "Type <strong>/</strong> to pick a command from a popup — <strong>/poll</strong> or <strong>/summarize</strong> — with arrow-key navigation.",
    side: "top",
  },
];

// Dashboard features, oldest → newest.
export const WHATS_NEW_DASH: WhatsNewStep[] = [
  {
    id: "api-keys",
    selector: '[data-tour="api-keys"]',
    title: "Programmatic API keys",
    body: "Mint a personal <strong>API key</strong> to create rooms and send invitations from your own scripts.",
    side: "top",
  },
  {
    id: "room-lifecycle",
    selector: '[data-tour="rooms"]',
    title: "Archive, restore & delete rooms",
    body: "Use the per-row actions to <strong>archive</strong>, <strong>restore</strong>, or permanently delete a room — and the tabs to filter Active vs. Archived.",
    side: "top",
  },
];

// Separate marker per surface (like the tour's two keys) so a room-only feature
// is never marked seen from the dashboard, or vice versa.
export const WHATS_NEW_KEYS = {
  room: "mindforum_whatsnew_room_v1",
  dashboard: "mindforum_whatsnew_dash_v1",
} as const;

// ---- Pure, DOM-independent helpers (store injected → unit-testable) ----

/**
 * Steps shipped since the user's last visit, for one surface.
 * - No marker (first visit): [] — treated as caught up; the caller seeds the
 *   marker silently rather than dumping the whole history on a new user.
 * - Marker found: everything AFTER it (the newer features).
 * - Marker unknown/stale (e.g. an old id no longer in the list): all steps.
 */
export function unseenWhatsNew(
  steps: WhatsNewStep[],
  store: KVStore,
  key: string
): WhatsNewStep[] {
  const seen = store.getItem(key);
  if (seen === null) return [];
  const idx = steps.findIndex((s) => s.id === seen);
  if (idx === -1) return steps.slice();
  return steps.slice(idx + 1);
}

/** Mark everything up to the newest (last) step as seen for this surface. */
export function markWhatsNewSeen(
  steps: WhatsNewStep[],
  store: KVStore,
  key: string
): void {
  if (steps.length === 0) return;
  store.setItem(key, steps[steps.length - 1].id);
}
