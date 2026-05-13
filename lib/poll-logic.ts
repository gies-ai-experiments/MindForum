export type OptionRow = { id: string; position: number; text: string };
export type VoteRow = { optionId: string };

export type TallyResult = {
  totalVotes: number;
  tallies: { optionId: string; text: string; votes: number }[];
  winnerOptionId: string | null;
  inconclusive: boolean;
};

export function computeTallies(options: OptionRow[], votes: VoteRow[]): TallyResult {
  const counts = new Map<string, number>();
  for (const o of options) counts.set(o.id, 0);
  for (const v of votes) counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);

  const tallies = options
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(o => ({ optionId: o.id, text: o.text, votes: counts.get(o.id) ?? 0 }));

  const totalVotes = votes.length;

  const sortedByVotes = tallies.slice().sort((a, b) => b.votes - a.votes);
  const top = sortedByVotes[0];
  const second = sortedByVotes[1];

  const tied = top && second && top.votes === second.votes && top.votes > 0;
  const winnerOptionId = !tied && top && top.votes > 0 ? top.optionId : null;
  const inconclusive = totalVotes < 2 || !!tied;

  return { totalVotes, tallies, winnerOptionId, inconclusive };
}

export type ValidateResult =
  | { ok: true; normalized: string[] }
  | { ok: false; error: "min_options" | "max_options" | "duplicate_options" };

export function validateOptions(raw: string[]): ValidateResult {
  const normalized = raw.map(s => s.trim()).filter(s => s.length > 0);
  if (normalized.length < 2) return { ok: false, error: "min_options" };
  if (normalized.length > 5) return { ok: false, error: "max_options" };
  const seen = new Set<string>();
  for (const s of normalized) {
    const k = s.toLowerCase();
    if (seen.has(k)) return { ok: false, error: "duplicate_options" };
    seen.add(k);
  }
  return { ok: true, normalized };
}

export function isExpired(p: { status: "open" | "closed"; closesAt: number | null }): boolean {
  if (p.status !== "open") return false;
  if (p.closesAt == null) return false;
  return p.closesAt <= Date.now();
}
