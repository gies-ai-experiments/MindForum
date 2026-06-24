// Pure helpers for the in-message quote embed used by the room composer.
// A quoted reply is stored inside the message content as two readable
// blockquote lines, then parsed back into a card at render time:
//
//   > {author} • {time}
//   > {snippet}
//
//   {reply body}

export const QUOTE_SNIPPET_MAX = 140;

/** Human-readable timestamp shared by the compose card and the embed. */
export function formatQuoteTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Build the quote block that gets prepended to the outgoing message content. */
export function buildQuotePrefix(authorName: string, createdAt: number, content: string): string {
  const snippet = content.replace(/\s+/g, " ").trim().slice(0, QUOTE_SNIPPET_MAX);
  return `> ${authorName} • ${formatQuoteTime(createdAt)}\n> ${snippet}\n\n`;
}

export type ParsedQuote = {
  quote: { authorName: string; time: string; text: string } | null;
  body: string;
};

/** Split a leading quote block (if present) from the message body. */
export function parseQuotedMessage(content: string): ParsedQuote {
  const m = content.match(/^> (.+?) • (.+?)\n> (.*)\n\n([\s\S]*)$/);
  if (!m) return { quote: null, body: content };
  return {
    quote: { authorName: m[1], time: m[2], text: m[3] },
    body: m[4],
  };
}
