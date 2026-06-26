import { test } from "node:test";
import assert from "node:assert/strict";
import { chatReplyStream } from "./openai.ts";

// Build a fake OpenAI whose .chat.completions.create returns a scripted stream.
function fakeOpenAI(scripts) {
  let call = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const chunks = scripts[call++];
          return (async function* () { for (const c of chunks) yield c; })();
        },
      },
    },
  };
}
const content = (s) => ({ choices: [{ delta: { content: s } }] });
const toolCall = (id, name, args) => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }],
});
const files = [{ name: "a.md", summary: "sum", extractedText: "FULL A", selected: true,
  id: "1", roomId: "r", mime: "text/markdown", sizeBytes: 1, uploadedById: "u",
  uploadedAt: 0, sourceType: "uploaded", sourceUrl: null, sourceMeta: null }];

test("answers directly → streams tokens, no read_document", async () => {
  const reads = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAI([[content("Hello "), content("world")]]),
    onReadDocument: (n) => reads.push(n),
  });
  let out = ""; for await (const t of gen) out += t;
  assert.equal(out, "Hello world");
  assert.deepEqual(reads, []);
});

test("escalates → reads a doc, then streams the final answer", async () => {
  const reads = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAI([
      [toolCall("call_1", "read_document", JSON.stringify({ name: "a.md" }))],
      [content("Per the file, X.")],
    ]),
    onReadDocument: (n) => reads.push(n),
  });
  let out = ""; for await (const t of gen) out += t;
  assert.equal(out, "Per the file, X.");
  assert.deepEqual(reads, ["a.md"]);
});

test("unknown file read → not reported, model still answers", async () => {
  const reads = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAI([
      [toolCall("call_1", "read_document", JSON.stringify({ name: "ghost.md" }))],
      [content("Sorry, no data.")],
    ]),
    onReadDocument: (n) => reads.push(n),
  });
  let out = ""; for await (const t of gen) out += t;
  assert.equal(out, "Sorry, no data.");
  assert.deepEqual(reads, []); // ghost.md not found → not grounded
});

// --- recap block injection (recap-mode feature) ---
function fakeOpenAICapturing(scripts, sink) {
  let call = 0;
  return {
    chat: { completions: { create: async (params) => {
      sink.push(params);
      const chunks = scripts[call++];
      return (async function* () { for (const c of chunks) yield c; })();
    } } },
  };
}

test("recapBlock is injected into the system prompt", async () => {
  const calls = [];
  const gen = chatReplyStream(
    [{ authorId: "u", authorName: "Ana", content: "hi", id: "m1", roomId: "r", createdAt: 0, kind: "chat" }],
    files, "", {
      openai: fakeOpenAICapturing([[content("ok")]], calls),
      recapBlock: "\n\nConversation so far (summary):\n- earlier stuff",
    });
  for await (const _ of gen) { /* drain */ }
  const sys = calls[0].messages[0];
  assert.equal(sys.role, "system");
  assert.match(sys.content, /Conversation so far/);
  assert.match(sys.content, /earlier stuff/);
});

test("only the passed messages become history (no hidden fetch)", async () => {
  const calls = [];
  const msgs = [
    { authorId: "u", authorName: "Ana", content: "one", id: "m1", roomId: "r", createdAt: 0, kind: "chat" },
    { authorId: "u", authorName: "Ana", content: "two", id: "m2", roomId: "r", createdAt: 1, kind: "chat" },
  ];
  const gen = chatReplyStream(msgs, files, "", {
    openai: fakeOpenAICapturing([[content("ok")]], calls),
    recapBlock: "",
  });
  for await (const _ of gen) { /* drain */ }
  assert.equal(calls[0].messages.length, 3); // system + 2 history turns
  assert.deepEqual(calls[0].messages.slice(1).map((m) => m.content), ["Ana: one", "Ana: two"]);
});

// --- web_search tool (per-room toggle) ---

test("web_search tool is omitted from tools unless enabled", async () => {
  const calls = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAICapturing([[content("ok")]], calls),
  });
  for await (const _ of gen) { /* drain */ }
  const names = (calls[0].tools ?? []).map((t) => t.function.name);
  assert.ok(names.includes("read_document"));
  assert.ok(!names.includes("web_search"));
});

test("web_search tool is offered when webSearch:true", async () => {
  const calls = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAICapturing([[content("ok")]], calls),
    webSearch: true,
  });
  for await (const _ of gen) { /* drain */ }
  const names = (calls[0].tools ?? []).map((t) => t.function.name);
  assert.ok(names.includes("web_search"));
});

test("web_search call → webSearchFn runs, result fed back, model cites", async () => {
  const searched = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAI([
      [toolCall("call_1", "web_search", JSON.stringify({ query: "EU AI Act 2026" }))],
      [content("Per recent sources, X.\n\n## Sources\n- https://e.com")],
    ]),
    webSearch: true,
    webSearchFn: async (q) => { searched.push(q); return "Findings: https://e.com"; },
    onWebSearch: (q) => { searched.push("cb:" + q); },
  });
  let out = ""; for await (const t of gen) out += t;
  assert.equal(searched[0], "EU AI Act 2026");
  assert.ok(searched.includes("cb:EU AI Act 2026"));
  assert.match(out, /## Sources/);
});
