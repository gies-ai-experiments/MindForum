import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  filterRepoEntries,
  flattenRepoEntries,
  isBinaryPath,
  parseGitHubRepoUrl,
  readTextEntries,
  splitGlobs,
} from "./github.ts";

test("parseGitHubRepoUrl accepts repo root and tree URLs", () => {
  assert.deepEqual(parseGitHubRepoUrl("https://github.com/octocat/Hello-World"), {
    owner: "octocat",
    repo: "Hello-World",
    ref: "HEAD",
    canonicalUrl: "https://github.com/octocat/Hello-World",
  });
  assert.deepEqual(parseGitHubRepoUrl("https://github.com/octocat/Hello-World/tree/main"), {
    owner: "octocat",
    repo: "Hello-World",
    ref: "main",
    canonicalUrl: "https://github.com/octocat/Hello-World/tree/main",
  });
  assert.deepEqual(parseGitHubRepoUrl("https://github.com/octocat/Hello-World/tree/feature/docs"), {
    owner: "octocat",
    repo: "Hello-World",
    ref: "feature/docs",
    canonicalUrl: "https://github.com/octocat/Hello-World/tree/feature/docs",
  });
});

test("parseGitHubRepoUrl rejects non-GitHub incomplete and unsupported URLs", () => {
  assert.throws(() => parseGitHubRepoUrl("https://example.com/octocat/Hello-World"), /invalid_github_url/);
  assert.throws(() => parseGitHubRepoUrl("https://github.com/octocat"), /invalid_github_url/);
  assert.throws(() => parseGitHubRepoUrl("http://github.com/octocat/Hello-World"), /invalid_github_url/);
  assert.throws(() => parseGitHubRepoUrl("https://github.com/octocat/Hello-World/issues"), /invalid_github_url/);
});

test("splitGlobs trims arrays and comma separated input before falling back", () => {
  assert.deepEqual(splitGlobs([" **/*.md ", "", "src/**"], ["fallback/**"]), ["**/*.md", "src/**"]);
  assert.deepEqual(splitGlobs("**/*.md, src/**, ", ["fallback/**"]), ["**/*.md", "src/**"]);
  assert.deepEqual(splitGlobs([], ["fallback/**"]), ["fallback/**"]);
  assert.deepEqual(splitGlobs(undefined, ["fallback/**"]), ["fallback/**"]);
});

test("isBinaryPath rejects common binary and packaged artifacts", () => {
  for (const filePath of [
    "public/logo.png",
    "docs/report.pdf",
    "assets/font.woff2",
    "packages/archive.tgz",
    "video/demo.mp4",
    "module.wasm",
  ]) {
    assert.equal(isBinaryPath(filePath), true, filePath);
  }

  assert.equal(isBinaryPath("src/app.ts"), false);
  assert.equal(isBinaryPath("README.md"), false);
  assert.equal(isBinaryPath("docs/notes.txt"), false);
});

test("filterRepoEntries applies include exclude globs and binary filtering", () => {
  const entries = [
    { path: "README.md", text: "readme" },
    { path: "src/app.ts", text: "app" },
    { path: "dist/app.js", text: "built" },
    { path: "notes/private.txt", text: "private" },
    { path: "public/logo.png", text: "binary" },
  ];

  assert.deepEqual(
    filterRepoEntries(entries, ["**/*.md", "**/*.ts", "**/*.txt", "**/*.png"], ["dist/**", "notes/**"]).map(
      (entry) => entry.path
    ),
    ["README.md", "src/app.ts"]
  );
});

test("filterRepoEntries supports dotfiles with default-style globs", () => {
  const entries = [
    { path: ".github/workflows/test.yml", text: "workflow" },
    { path: ".next/server/app.js", text: "build" },
    { path: "src/index.ts", text: "source" },
  ];

  assert.deepEqual(
    filterRepoEntries(entries, ["**/*.yml", "**/*.ts"], [".next/**"]).map((entry) => entry.path),
    [".github/workflows/test.yml", "src/index.ts"]
  );
});

test("flattenRepoEntries labels files and enforces max chars", () => {
  const entries = [
    { path: "README.md", text: "hello" },
    { path: "src/app.ts", text: "console.log(1)" },
  ];

  const result = flattenRepoEntries(entries, 1000);
  assert.equal(result.fileCount, 2);
  assert.equal(result.charCount, result.text.length);
  assert.match(result.text, /--- FILE: README.md ---/);
  assert.match(result.text, /--- FILE: src\/app.ts ---/);
  assert.throws(() => flattenRepoEntries(entries, 10), /too_large/);
});

test("readTextEntries skips symlinks and enforces per-file limits", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mindforum-gh-test-"));
  try {
    await writeFile(path.join(dir, "README.md"), "safe readme");
    await writeFile(path.join(dir, "huge.md"), "x".repeat(512 * 1024 + 1));
    await symlink("/etc/passwd", path.join(dir, "passwd.md"));

    const entries = await readTextEntries(dir);
    assert.deepEqual(entries, [{ path: "README.md", text: "safe readme" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
