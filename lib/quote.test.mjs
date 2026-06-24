import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_SNIPPET_MAX,
  formatQuoteTime,
  buildQuotePrefix,
  parseQuotedMessage,
} from "./quote.ts";

const TS = 1782318746345;

test("formatQuoteTime is deterministic and non-empty", () => {
  const a = formatQuoteTime(TS);
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
  assert.equal(a, formatQuoteTime(TS)); // stable for same input
});

test("buildQuotePrefix produces a two-line blockquote ending in a blank line", () => {
  const p = buildQuotePrefix("Ada Lovelace", TS, "Hi everyone, kicking off the brainstorm.");
  assert.ok(p.startsWith("> Ada Lovelace • "));
  assert.ok(p.includes("\n> Hi everyone, kicking off the brainstorm.\n\n"));
  assert.ok(p.endsWith("\n\n"));
});

test("buildQuotePrefix collapses whitespace and caps the snippet at QUOTE_SNIPPET_MAX", () => {
  const long = "x".repeat(QUOTE_SNIPPET_MAX + 50);
  const p = buildQuotePrefix("Bob", TS, "line1\n   line2\t spaced");
  assert.ok(p.includes("> line1 line2 spaced\n\n"));
  const pLong = buildQuotePrefix("Bob", TS, long);
  const snippetLine = pLong.split("\n")[1]; // "> xxxx..."
  assert.equal(snippetLine, "> " + "x".repeat(QUOTE_SNIPPET_MAX));
});

test("parseQuotedMessage round-trips a built embed and splits the body", () => {
  const content = buildQuotePrefix("Ada Lovelace", TS, "Hi everyone, kicking off") + "my reply text";
  const { quote, body } = parseQuotedMessage(content);
  assert.ok(quote);
  assert.equal(quote.authorName, "Ada Lovelace");
  assert.equal(quote.text, "Hi everyone, kicking off");
  assert.equal(quote.time, formatQuoteTime(TS));
  assert.equal(body, "my reply text");
});

test("parseQuotedMessage preserves a multi-paragraph body", () => {
  const content = buildQuotePrefix("Bob", TS, "snippet") + "line1\n\nline2";
  assert.equal(parseQuotedMessage(content).body, "line1\n\nline2");
});

test("parseQuotedMessage returns no quote for plain or old-format messages", () => {
  assert.deepEqual(parseQuotedMessage("just a normal message"), {
    quote: null,
    body: "just a normal message",
  });
  // old format ("> Author: text") has no • and no second > line → not a card
  const old = "> Old Author: some text\n\nbody";
  assert.equal(parseQuotedMessage(old).quote, null);
  assert.equal(parseQuotedMessage(old).body, old);
});
