// Server-safe @-mention extraction for arming mention reminders.
// Mirrors the token/boundary rules in lib/notify.ts (which is client-only —
// it touches browser APIs — so it cannot be imported here). Keep the two in
// sync by hand: full-name + first-name tokens, @<token>\b, case-insensitive.

export type MentionableParticipant = { id: string; name: string; email: string };
export type MentionedParticipant = { id: string; name: string; email: string };

const RESERVED = new Set(["ai", "all", "everyone"]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameTokens(fullName: string): string[] {
  const trimmed = fullName.trim();
  if (!trimmed) return [];
  const tokens = new Set<string>();
  tokens.add(trimmed);
  const firstRaw = trimmed.split(/\s+/)[0] ?? "";
  const first = firstRaw.replace(/[.,;:!?]+$/, "");
  if (first && first !== trimmed && first.length >= 2) tokens.add(first);
  return [...tokens];
}

/**
 * Return the distinct human participants directly @mentioned in `content`,
 * excluding the author and the reserved @ai/@all/@everyone tokens.
 */
export function extractDirectMentions(
  content: string,
  participants: MentionableParticipant[],
  authorId: string,
): MentionedParticipant[] {
  if (!content) return [];
  const out: MentionedParticipant[] = [];
  const seen = new Set<string>();
  for (const p of participants) {
    if (p.id === authorId || seen.has(p.id)) continue;
    for (const token of nameTokens(p.name)) {
      if (RESERVED.has(token.toLowerCase())) continue;
      const re = new RegExp(`@${escapeRegex(token)}\\b`, "i");
      if (re.test(content)) {
        out.push({ id: p.id, name: p.name, email: p.email });
        seen.add(p.id);
        break;
      }
    }
  }
  return out;
}
