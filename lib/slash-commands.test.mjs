import { test } from "node:test";
import assert from "node:assert/strict";
import { SLASH_COMMANDS, matchSlashCommands } from "./slash-commands.ts";

const cmds = (r) => r.map((c) => c.cmd);

test("SLASH_COMMANDS lists /poll and /summarize, each with a description", () => {
  assert.deepEqual(cmds(SLASH_COMMANDS).sort(), ["/poll", "/summarize"]);
  for (const c of SLASH_COMMANDS) assert.equal(typeof c.desc, "string");
  for (const c of SLASH_COMMANDS) assert.ok(c.desc.length > 0);
});

test("a bare leading slash returns every command", () => {
  assert.deepEqual(cmds(matchSlashCommands("/")).sort(), ["/poll", "/summarize"]);
});

test("filters by the typed prefix", () => {
  assert.deepEqual(cmds(matchSlashCommands("/p")), ["/poll"]);
  assert.deepEqual(cmds(matchSlashCommands("/su")), ["/summarize"]);
  assert.deepEqual(cmds(matchSlashCommands("/sum")), ["/summarize"]);
});

test("an exact command (no trailing space) still matches itself", () => {
  assert.deepEqual(cmds(matchSlashCommands("/poll")), ["/poll"]);
});

test("a prefix that matches nothing returns []", () => {
  assert.deepEqual(matchSlashCommands("/xyz"), []);
});

test("a space (args started / ready to send) closes the menu", () => {
  assert.deepEqual(matchSlashCommands("/poll "), []);
  assert.deepEqual(matchSlashCommands("/poll question?"), []);
});

test("only triggers at the very start — not mid-text, not after leading whitespace", () => {
  assert.deepEqual(matchSlashCommands("hello /poll"), []);
  assert.deepEqual(matchSlashCommands("  /poll"), []);
});

test("empty draft returns []", () => {
  assert.deepEqual(matchSlashCommands(""), []);
});

test("matching is case-insensitive on the typed prefix", () => {
  assert.deepEqual(cmds(matchSlashCommands("/SU")), ["/summarize"]);
});
