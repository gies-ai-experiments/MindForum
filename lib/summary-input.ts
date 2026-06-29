// Pure request validation + filename helper for the /summarize command.
export const MAX_SUMMARY_TEXT_CHARS = 20000;

export type SummaryRequest =
  | { source: "room"; post: boolean }
  | { source: "text"; text: string; post: boolean };

export function validateSummaryRequest(
  body: unknown,
):
  | { ok: true; value: SummaryRequest }
  | { ok: false; error: "bad_source" | "text_required" | "text_too_long" } {
  const b = (body ?? {}) as Record<string, unknown>;
  const post = b.post === false ? false : true;
  if (b.source === "room") return { ok: true, value: { source: "room", post } };
  if (b.source === "text") {
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!text) return { ok: false, error: "text_required" };
    if (text.length > MAX_SUMMARY_TEXT_CHARS) return { ok: false, error: "text_too_long" };
    return { ok: true, value: { source: "text", text, post } };
  }
  return { ok: false, error: "bad_source" };
}

export function summaryFilename(createdAt: number): string {
  const stamp = new Date(createdAt).toISOString().slice(0, 10);
  return `mindforum-summary-${stamp}.md`;
}
