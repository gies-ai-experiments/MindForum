// Server-only, in-memory presence tracking. Mirrors lib/sse.ts: state lives on
// globalThis so it survives Next.js dev HMR. Per-process only — if the app ever
// runs on >1 instance, presence is per-instance, exactly like the existing
// in-memory SSE broadcast. Color helpers deliberately live in presence-color.ts
// so the client bundle never pulls in this module's globals.

type Counts = Map<string, number>; // participantId -> open-connection count

const g = globalThis as unknown as { __mindforumPresence?: Map<string, Counts> };
const rooms: Map<string, Counts> = g.__mindforumPresence ?? new Map();
g.__mindforumPresence = rooms;

/** Register a new connection. Returns true only on the 0→1 transition. */
export function markOnline(roomId: string, participantId: string): boolean {
  let counts = rooms.get(roomId);
  if (!counts) {
    counts = new Map();
    rooms.set(roomId, counts);
  }
  const prev = counts.get(participantId) ?? 0;
  counts.set(participantId, prev + 1);
  return prev === 0;
}

/** Drop a connection. Returns true only on the 1→0 transition. */
export function markOffline(roomId: string, participantId: string): boolean {
  const counts = rooms.get(roomId);
  if (!counts) return false;
  const prev = counts.get(participantId) ?? 0;
  if (prev <= 1) {
    counts.delete(participantId);
    if (counts.size === 0) rooms.delete(roomId);
    return prev === 1;
  }
  counts.set(participantId, prev - 1);
  return false;
}

export function onlineParticipantIds(roomId: string): Set<string> {
  const counts = rooms.get(roomId);
  return new Set(counts ? counts.keys() : []);
}
