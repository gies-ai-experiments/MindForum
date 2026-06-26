import { test } from "node:test";
import assert from "node:assert/strict";
import { webSearch } from "./web-search.ts";

function fakeClient(output_text, output = []) {
  return { responses: { create: async () => ({ output_text, output }) } };
}

test("returns trimmed findings and counts web_search_call items", async () => {
  const client = fakeClient("  Findings — see https://e.com  ", [
    { type: "web_search_call" },
    { type: "message" },
    { type: "web_search_call" },
  ]);
  const res = await webSearch("EU AI Act 2026", { client });
  assert.equal(res.text, "Findings — see https://e.com");
  assert.equal(res.callCount, 2);
});

test("degrades to an unavailable message when the call throws", async () => {
  const client = { responses: { create: async () => { throw new Error("boom"); } } };
  const res = await webSearch("anything", { client });
  assert.match(res.text, /unavailable/i);
  assert.equal(res.callCount, 0);
});

test("passes the query as input to the model", async () => {
  let seen = null;
  const client = { responses: { create: async (params) => { seen = params; return { output_text: "ok", output: [] }; } } };
  await webSearch("my query", { client });
  assert.ok(JSON.stringify(seen.input).includes("my query"));
  assert.ok(seen.tools.some((t) => t.type === "web_search_preview"));
  assert.match(seen.instructions, /at most 3 web_search calls/i); // hard cap is instructed
});
