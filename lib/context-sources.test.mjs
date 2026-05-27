import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTACH_RATE,
  DEFAULT_GITHUB_EXCLUDE,
  DEFAULT_GITHUB_INCLUDE,
  SOURCE_TYPES,
  isSourceType,
  publicRoomFile,
} from "./context-sources.ts";

test("source type guard accepts only v1 source types", () => {
  assert.deepEqual(SOURCE_TYPES, ["upload", "github", "url"]);
  assert.equal(isSourceType("upload"), true);
  assert.equal(isSourceType("github"), true);
  assert.equal(isSourceType("url"), true);
  assert.equal(isSourceType("rss"), false);
  assert.equal(isSourceType(null), false);
});

test("default GitHub globs include source docs and exclude build outputs", () => {
  assert.ok(DEFAULT_GITHUB_INCLUDE.includes("**/*.md"));
  assert.ok(DEFAULT_GITHUB_INCLUDE.includes("**/*.tsx"));
  assert.ok(DEFAULT_GITHUB_EXCLUDE.includes("node_modules/**"));
  assert.ok(DEFAULT_GITHUB_EXCLUDE.includes(".next/**"));
});

test("attach rate is shared across upload and external context routes", () => {
  assert.deepEqual(ATTACH_RATE, { bucket: "attach", limit: 10, windowMs: 10 * 60 * 1000 });
});

test("publicRoomFile drops extractedText and selected but keeps source metadata", () => {
  const publicFile = publicRoomFile({
    id: "f1",
    roomId: "r1",
    name: "Repo: octocat/Hello-World",
    mime: "text/markdown",
    sizeBytes: 123,
    uploadedById: "p1",
    uploadedAt: 1,
    extractedText: "secret prompt text",
    selected: true,
    sourceType: "github",
    sourceUrl: "https://github.com/octocat/Hello-World",
    sourceMeta: { owner: "octocat", repo: "Hello-World", fileCount: 1 },
  });
  assert.equal("extractedText" in publicFile, false);
  assert.equal("selected" in publicFile, false);
  assert.equal(publicFile.sourceType, "github");
  assert.equal(publicFile.sourceUrl, "https://github.com/octocat/Hello-World");
  assert.deepEqual(publicFile.sourceMeta, { owner: "octocat", repo: "Hello-World", fileCount: 1 });
});
