import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTACH_RATE,
  DEFAULT_GITHUB_EXCLUDE,
  DEFAULT_GITHUB_INCLUDE,
  SOURCE_TYPES,
  isSourceType,
  parseTrustedGitHubUrl,
  publicRoomFile,
  sourceLabel,
  untrustedSourceWarning,
  validateSourceMeta,
} from "./context-sources.ts";

test("source type guard accepts only v1 source types", () => {
  assert.deepEqual(SOURCE_TYPES, ["uploaded", "github_repo", "web_url"]);
  assert.equal(isSourceType("uploaded"), true);
  assert.equal(isSourceType("github_repo"), true);
  assert.equal(isSourceType("web_url"), true);
  assert.equal(isSourceType("rss"), false);
  assert.equal(isSourceType(null), false);
});

test("trusted GitHub URL parser accepts only public github.com repositories", () => {
  assert.deepEqual(parseTrustedGitHubUrl("https://github.com/octocat/Hello-World"), {
    owner: "octocat",
    repo: "Hello-World",
    ref: "HEAD",
    url: "https://github.com/octocat/Hello-World",
  });
  assert.equal(parseTrustedGitHubUrl("https://github.com/octocat/Hello-World/tree/main")?.ref, "main");
  assert.equal(parseTrustedGitHubUrl("http://github.com/octocat/Hello-World"), null);
  assert.equal(parseTrustedGitHubUrl("https://gist.github.com/octocat/1"), null);
  assert.equal(parseTrustedGitHubUrl("https://example.com/octocat/Hello-World"), null);
  assert.equal(parseTrustedGitHubUrl("https://github.com/octocat/Hello-World/issues"), null);
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

test("source labels and warnings are explicit for v1 source types", () => {
  assert.equal(sourceLabel("uploaded"), "Uploaded file");
  assert.equal(sourceLabel("github_repo"), "GitHub repository");
  assert.equal(sourceLabel("web_url"), "Web page");
  assert.match(untrustedSourceWarning("github_repo"), /untrusted source material/);
});

test("source metadata validator requires complete metadata", () => {
  assert.equal(validateSourceMeta("uploaded", { ignored: true }), null);
  assert.deepEqual(
    validateSourceMeta("github_repo", {
      owner: "octocat",
      repo: "Hello-World",
      ref: "HEAD",
      include: ["**/*.md"],
      exclude: ["node_modules/**"],
      fileCount: 1,
      charCount: 100,
    }),
    {
      owner: "octocat",
      repo: "Hello-World",
      ref: "HEAD",
      include: ["**/*.md"],
      exclude: ["node_modules/**"],
      fileCount: 1,
      charCount: 100,
    }
  );
  assert.equal(validateSourceMeta("github_repo", { owner: "octocat", repo: "Hello-World" }), null);
  assert.deepEqual(
    validateSourceMeta("web_url", {
      instruction: "Summarize",
      contentType: "text/html",
      originalLength: 1000,
      readableLength: 500,
      extractedLength: 250,
      model: "gpt-5.4",
    }),
    {
      instruction: "Summarize",
      contentType: "text/html",
      originalLength: 1000,
      readableLength: 500,
      extractedLength: 250,
      model: "gpt-5.4",
    }
  );
  assert.equal(validateSourceMeta("web_url", { contentType: "text/html" }), null);
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
    sourceType: "github_repo",
    sourceUrl: "https://github.com/octocat/Hello-World",
    sourceMeta: {
      owner: "octocat",
      repo: "Hello-World",
      ref: "HEAD",
      include: ["**/*.md"],
      exclude: [],
      fileCount: 1,
      charCount: 123,
    },
  });
  assert.equal("extractedText" in publicFile, false);
  assert.equal("selected" in publicFile, false);
  assert.equal(publicFile.sourceType, "github_repo");
  assert.equal(publicFile.sourceUrl, "https://github.com/octocat/Hello-World");
  assert.deepEqual(publicFile.sourceMeta, {
    owner: "octocat",
    repo: "Hello-World",
    ref: "HEAD",
    include: ["**/*.md"],
    exclude: [],
    fileCount: 1,
    charCount: 123,
  });
});
