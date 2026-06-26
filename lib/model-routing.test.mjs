import { test } from "node:test";
import assert from "node:assert/strict";
import { isLongContext, modelForTask } from "./model-routing.ts";

const OLD_ENV = { ...process.env };

function resetEnv() {
  process.env.OPENAI_MODEL = "";
  process.env.OPENAI_MODEL_DEFAULT = "";
  process.env.OPENAI_MODEL_FAST = "";
  process.env.OPENAI_MODEL_STRONG = "";
  process.env.OPENAI_MODEL_BRIEF = "";
}

test.afterEach(() => {
  process.env = { ...OLD_ENV };
});

test("long context triggers on files, recap, or more than 30 messages", () => {
  assert.equal(isLongContext({ messageCount: 30 }), false);
  assert.equal(isLongContext({ messageCount: 31 }), true);
  assert.equal(isLongContext({ messageCount: 1, selectedFileCount: 1 }), true);
  assert.equal(isLongContext({ messageCount: 1, recapBlock: "\nsummary" }), true);
});

test("fast tasks use OPENAI_MODEL_FAST when present", () => {
  resetEnv();
  process.env.OPENAI_MODEL = "gpt-5.4";
  process.env.OPENAI_MODEL_FAST = "gpt-4.1";
  assert.equal(modelForTask("document-summary"), "gpt-4.1");
  assert.equal(modelForTask("url-extract"), "gpt-4.1");
});

test("normal chat uses default, long-context chat uses strong", () => {
  resetEnv();
  process.env.OPENAI_MODEL_DEFAULT = "gpt-4.1";
  process.env.OPENAI_MODEL_STRONG = "gpt-5.4";
  assert.equal(modelForTask("chat-reply", { messageCount: 3 }), "gpt-4.1");
  assert.equal(modelForTask("chat-reply", { messageCount: 3, selectedFileCount: 1 }), "gpt-5.4");
});

test("briefs and rolling summaries always use strong", () => {
  resetEnv();
  process.env.OPENAI_MODEL = "gpt-4.1";
  process.env.OPENAI_MODEL_STRONG = "gpt-5.4";
  assert.equal(modelForTask("brief"), "gpt-5.4");
  assert.equal(modelForTask("rolling-summary"), "gpt-5.4");
});

test("legacy env falls back to OPENAI_MODEL when new vars are absent", () => {
  resetEnv();
  process.env.OPENAI_MODEL = "legacy-model";
  assert.equal(modelForTask("chat-reply", { messageCount: 0 }), "legacy-model");
  assert.equal(modelForTask("brief"), "legacy-model");
});

test("summary task: default tier short, strong when long-context", () => {
  resetEnv();
  process.env.OPENAI_MODEL_DEFAULT = "gpt-4.1";
  process.env.OPENAI_MODEL_STRONG = "gpt-5.4";
  assert.equal(modelForTask("summary", { messageCount: 5 }), "gpt-4.1");
  assert.equal(modelForTask("summary", { messageCount: 99 }), "gpt-5.4");
});

test("prompt generation always uses strong", () => {
  resetEnv();
  process.env.OPENAI_MODEL = "gpt-4.1";
  process.env.OPENAI_MODEL_STRONG = "gpt-5.4";
  assert.equal(modelForTask("prompt-generate"), "gpt-5.4");
});

test("prompt generation falls back to legacy OPENAI_MODEL when strong unset", () => {
  resetEnv();
  process.env.OPENAI_MODEL = "legacy-model";
  assert.equal(modelForTask("prompt-generate"), "legacy-model");
});
