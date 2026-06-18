export type CandidateSource = "creator" | "participant";

export type InviteCandidate = {
  id: string;
  email: string;
  displayName: string;
  source: CandidateSource;
};

export type InviteSuggestion = {
  id: string;
  email: string;
  displayName: string;
};

export function dedupeAndRankCandidates(
  pool: InviteCandidate[],
  query: string,
  limit: number,
  excludeEmail?: string
): InviteSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exclude = excludeEmail?.trim().toLowerCase();

  // Dedupe by lowercased email; a creator entry wins over a participant entry.
  const byEmail = new Map<string, InviteCandidate>();
  for (const c of pool) {
    const key = c.email.trim().toLowerCase();
    if (!key) continue;
    if (exclude && key === exclude) continue;
    const prev = byEmail.get(key);
    if (!prev || (prev.source === "participant" && c.source === "creator")) {
      byEmail.set(key, c);
    }
  }

  const ranked: { c: InviteCandidate; rank: number }[] = [];
  for (const c of byEmail.values()) {
    const name = c.displayName.toLowerCase();
    const email = c.email.toLowerCase();
    const nameIdx = name.indexOf(q);
    const emailIdx = email.indexOf(q);
    if (nameIdx === -1 && emailIdx === -1) continue;
    // 0 = name prefix, 1 = name substring, 2 = email-only match
    const rank = nameIdx === 0 ? 0 : nameIdx > 0 ? 1 : 2;
    ranked.push({ c, rank });
  }
  ranked.sort(
    (a, b) => a.rank - b.rank || a.c.displayName.localeCompare(b.c.displayName)
  );
  return ranked
    .slice(0, limit)
    .map(({ c }) => ({ id: c.id, email: c.email, displayName: c.displayName }));
}
