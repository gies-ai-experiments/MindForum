import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createExtractCounter,
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

// Real GitHub tarballs nest everything under `<owner>-<repo>-<sha>/`, so the
// path the filter sees is prefixed. These tests model that.
const PFX = "owner-repo-abc123/";

test("createExtractCounter skips binaries, symlinks, and lets included paths through", () => {
  const include = ["**/*.md", "**/*.ts"];
  const exclude = ["dist/**"];
  const { filter } = createExtractCounter(include, exclude);
  assert.equal(filter(`${PFX}case/code.gif`, { type: "File", size: 12_000_000 }), false);
  assert.equal(filter(`${PFX}images/logo.png`, { type: "File", size: 200_000 }), false);
  assert.equal(filter(`${PFX}link.md`, { type: "SymbolicLink" }), false);
  assert.equal(filter(`${PFX}hardlink.md`, { type: "Link" }), false);
  assert.equal(filter(`${PFX}subdir`, { type: "Directory" }), true);
  assert.equal(filter(`${PFX}README.md`, { type: "File", size: 1024 }), true);
  assert.equal(filter(`${PFX}src/app.ts`, { type: "File", size: 2048 }), true);
});

test("createExtractCounter skips files outside include globs and inside exclude globs", () => {
  const include = ["**/*.md"];
  const exclude = ["docs/draft/**"];
  const { filter } = createExtractCounter(include, exclude);
  // not in include
  assert.equal(filter(`${PFX}src/app.ts`, { type: "File", size: 100 }), false);
  // in include
  assert.equal(filter(`${PFX}README.md`, { type: "File", size: 100 }), true);
  // in include but excluded
  assert.equal(filter(`${PFX}docs/draft/wip.md`, { type: "File", size: 100 }), false);
});

test("createExtractCounter does not count rejected entries toward caps", () => {
  const include = ["**/*.md"];
  const exclude = [];
  const { filter } = createExtractCounter(include, exclude);
  // A 19 MB GIF should be rejected without burning the 20 MB cap.
  assert.equal(filter(`${PFX}case/big.gif`, { type: "File", size: 19 * 1024 * 1024 }), false);
  // A non-included source file should be rejected without burning the cap.
  assert.equal(filter(`${PFX}src/big.ts`, { type: "File", size: 19 * 1024 * 1024 }), false);
  // Then a 10 MB markdown file should still pass.
  assert.equal(filter(`${PFX}docs/intro.md`, { type: "File", size: 10 * 1024 * 1024 }), true);
});

test("createExtractCounter throws github_repo_too_large past expanded-bytes cap", () => {
  const { filter } = createExtractCounter(["**/*.md"], []);
  assert.equal(filter(`${PFX}a.md`, { type: "File", size: 15 * 1024 * 1024 }), true);
  assert.throws(
    () => filter(`${PFX}b.md`, { type: "File", size: 6 * 1024 * 1024 }),
    /github_repo_too_large/
  );
});

test("createExtractCounter throws github_repo_too_large past file-count cap", () => {
  const { filter } = createExtractCounter(["**/*.md"], []);
  for (let i = 0; i < 2000; i += 1) {
    assert.equal(filter(`${PFX}file${i}.md`, { type: "File", size: 10 }), true);
  }
  assert.throws(
    () => filter(`${PFX}file2000.md`, { type: "File", size: 10 }),
    /github_repo_too_large/
  );
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
