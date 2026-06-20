export type InviteBatchEntry = { inviteeEmail: string; inviteeName: string };

const MAX_BATCH = 50;

/**
 * Normalize a bulk-invite request body into a clean, deduped list of invites.
 *
 * Keeps only entries whose `inviteeEmail` is a string containing "@" and whose
 * `inviteeName` is a non-empty string; trims both fields; drops case-insensitive
 * duplicate emails (first wins); caps the result at 50. Returns [] for any
 * non-array / missing `invites`. Pure — no I/O.
 */
export function parseInviteBatch(body: unknown): InviteBatchEntry[] {
  const raw = (body as { invites?: unknown } | null)?.invites;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: InviteBatchEntry[] = [];
  for (const item of raw) {
    const email =
      typeof (item as { inviteeEmail?: unknown })?.inviteeEmail === "string"
        ? (item as { inviteeEmail: string }).inviteeEmail.trim()
        : "";
    const name =
      typeof (item as { inviteeName?: unknown })?.inviteeName === "string"
        ? (item as { inviteeName: string }).inviteeName.trim()
        : "";
    if (!email.includes("@") || name.length === 0) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ inviteeEmail: email, inviteeName: name });
    if (out.length >= MAX_BATCH) break;
  }
  return out;
}
