// Pure presence-state helpers, shared by the in-room sidebar, the dashboard
// ParticipantsPanel, and unit tests. No globals, no runtime-specific APIs —
// safe to import anywhere (including client bundles).

export const YELLOW_TTL_MS = 15 * 60 * 1000; // disconnected within 15 min → yellow
export const GREEN_GRACE_MS = 20 * 1000; // stay green ~20s after disconnect (refresh guard)

export type PresenceColor = "green" | "yellow" | "none";

export function presenceColor(
  online: boolean,
  lastSeenAt: number | null,
  now: number,
): PresenceColor {
  if (online) return "green";
  if (lastSeenAt == null) return "none";
  const elapsed = now - lastSeenAt;
  if (elapsed < GREEN_GRACE_MS) return "green";
  if (elapsed < YELLOW_TTL_MS) return "yellow";
  return "none";
}

export function presenceLabel(
  online: boolean,
  lastSeenAt: number | null,
  now: number,
): string {
  const c = presenceColor(online, lastSeenAt, now);
  if (c === "green") return "Online";
  if (c === "none") return "Offline";
  const mins = Math.max(1, Math.round((now - (lastSeenAt ?? now)) / 60_000));
  return `Last seen ${mins}m ago`;
}
