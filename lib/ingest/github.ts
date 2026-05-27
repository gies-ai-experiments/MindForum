import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { minimatch } from "minimatch";
import { extract } from "tar";
import type { GitHubSourceMeta } from "../context-sources";

const GITHUB_FETCH_TIMEOUT_MS = 20_000;
const GITHUB_TARBALL_MAX_BYTES = 25 * 1024 * 1024;
const GITHUB_USER_AGENT = "MindForum external-context";
const DEFAULT_GITHUB_INCLUDE = [
  "**/*.md",
  "**/*.py",
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.json",
  "**/*.txt",
  "**/*.rst",
  "**/*.toml",
  "**/*.yaml",
  "**/*.yml",
];
const DEFAULT_GITHUB_EXCLUDE = [
  "node_modules/**",
  ".git/**",
  "*.lock",
  "dist/**",
  "build/**",
  ".next/**",
  "coverage/**",
];
const MAX_CONTEXT_CHARS = 200_000;

export type ParsedGitHubUrl = {
  owner: string;
  repo: string;
  ref: string;
  canonicalUrl: string;
};

export type RepoEntry = { path: string; text: string };

export type GitHubIngestInput = {
  url: string;
  include?: string[];
  exclude?: string[];
  fetchImpl?: typeof fetch;
};

export type GitHubIngestResult = {
  name: string;
  mime: string;
  sizeBytes: number;
  extractedText: string;
  sourceUrl: string;
  sourceMeta: GitHubSourceMeta;
};

export type GitHubPreviewResult = {
  name: string;
  sourceUrl: string;
  sourceMeta: GitHubSourceMeta;
  sizeBytes: number;
};

export function parseGitHubRepoUrl(raw: string): ParsedGitHubUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("invalid_github_url");
  }

  if (url.protocol !== "https:" || url.hostname !== "github.com") throw new Error("invalid_github_url");

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("invalid_github_url");

  const [owner, repoSegment, marker, ...rest] = parts;
  if (!isGitHubPathSegment(owner) || !isGitHubPathSegment(repoSegment)) throw new Error("invalid_github_url");
  if (marker && (marker !== "tree" || rest.length === 0)) throw new Error("invalid_github_url");

  const repo = repoSegment.replace(/\.git$/i, "");
  const ref = marker === "tree" ? rest.join("/") : "HEAD";
  const rootUrl = `https://github.com/${owner}/${repo}`;

  if (ref !== "HEAD" && !ref.split("/").every(isGitHubPathSegment)) throw new Error("invalid_github_url");

  return {
    owner,
    repo,
    ref,
    canonicalUrl: ref === "HEAD" ? rootUrl : `${rootUrl}/tree/${encodeGitHubRef(ref)}`,
  };
}

export function splitGlobs(value: string[] | string | undefined, fallback: string[]): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const globs = raw.map((item) => item.trim()).filter(Boolean);
  return globs.length > 0 ? globs : fallback;
}

export function isBinaryPath(filePath: string): boolean {
  return /\.(avif|bmp|eot|gif|gz|ico|jpeg|jpg|mov|mp3|mp4|otf|pdf|png|tar|tgz|ttf|wasm|wav|webm|webp|woff|woff2|zip)$/i.test(
    filePath
  );
}

export function filterRepoEntries(entries: RepoEntry[], include: string[], exclude: string[]): RepoEntry[] {
  return entries.filter((entry) => {
    if (isBinaryPath(entry.path)) return false;
    const included = include.some((pattern) => minimatch(entry.path, pattern, { dot: true }));
    const excluded = exclude.some((pattern) => minimatch(entry.path, pattern, { dot: true }));
    return included && !excluded;
  });
}

export function flattenRepoEntries(entries: RepoEntry[], maxChars = MAX_CONTEXT_CHARS) {
  let text = "";

  for (const entry of entries) {
    const trimmed = entry.text.trim();
    if (!trimmed) continue;

    const block = `--- FILE: ${entry.path} ---\n${trimmed}\n\n`;
    if (text.length + block.length > maxChars) {
      throw new Error(`too_large:${text.length + block.length}`);
    }
    text += block;
  }

  const flattened = text.trim();
  return { text: flattened, fileCount: entries.length, charCount: flattened.length };
}

export async function ingestGitHubRepo(input: GitHubIngestInput): Promise<GitHubIngestResult> {
  const parsed = parseGitHubRepoUrl(input.url);
  const include = splitGlobs(input.include, DEFAULT_GITHUB_INCLUDE);
  const exclude = splitGlobs(input.exclude, DEFAULT_GITHUB_EXCLUDE);
  const fetchImpl = input.fetchImpl ?? fetch;
  const tarballUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/tarball/${encodeGitHubRef(
    parsed.ref
  )}`;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), GITHUB_FETCH_TIMEOUT_MS);
  const tmp = await mkdtemp(path.join(tmpdir(), "mindforum-gh-"));
  const tarPath = path.join(tmp, "repo.tar.gz");

  try {
    const response = await fetchImpl(tarballUrl, {
      headers: { "user-agent": GITHUB_USER_AGENT },
      signal: abort.signal,
    });

    await writeGitHubTarball(response, tarPath);
    await extract({ cwd: tmp, file: tarPath, strip: 1, strict: true });

    const entries = await readTextEntries(tmp);
    const filtered = filterRepoEntries(entries, include, exclude);
    const flattened = flattenRepoEntries(filtered, MAX_CONTEXT_CHARS);

    return {
      name: `GitHub: ${parsed.owner}/${parsed.repo}`,
      mime: "text/markdown",
      sizeBytes: Buffer.byteLength(flattened.text, "utf8"),
      extractedText: flattened.text,
      sourceUrl: parsed.canonicalUrl,
      sourceMeta: {
        owner: parsed.owner,
        repo: parsed.repo,
        ref: parsed.ref,
        include,
        exclude,
        fileCount: flattened.fileCount,
        charCount: flattened.charCount,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("github_fetch_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function previewGitHubRepo(input: GitHubIngestInput): Promise<GitHubPreviewResult> {
  const ingested = await ingestGitHubRepo(input);
  return {
    name: ingested.name,
    sourceUrl: ingested.sourceUrl,
    sourceMeta: ingested.sourceMeta,
    sizeBytes: ingested.sizeBytes,
  };
}

async function writeGitHubTarball(response: Response, tarPath: string): Promise<void> {
  if (response.status === 404) throw new Error("github_repo_not_found");
  if (response.status === 403 || response.status === 429) throw new Error("github_rate_limited");
  if (!response.ok || !response.body) throw new Error(`github_fetch_failed:${response.status}`);

  const length = response.headers.get("content-length");
  if (length && Number(length) > GITHUB_TARBALL_MAX_BYTES) throw new Error("github_tarball_too_large");

  let downloaded = 0;
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      downloaded += value.byteLength;
      if (downloaded > GITHUB_TARBALL_MAX_BYTES) {
        controller.error(new Error("github_tarball_too_large"));
        return;
      }

      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  await pipeline(Readable.fromWeb(stream as unknown as NodeReadableStream<Uint8Array>), createWriteStream(tarPath));
}

async function readTextEntries(root: string): Promise<RepoEntry[]> {
  const out: RepoEntry[] = [];

  async function walk(dir: string) {
    for (const name of await readdir(dir)) {
      if (name === "repo.tar.gz") continue;

      const absolutePath = path.join(dir, name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const info = await stat(absolutePath);

      if (info.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!info.isFile() || isBinaryPath(relativePath)) continue;

      const buffer = await readFile(absolutePath);
      if (buffer.includes(0)) continue;

      out.push({ path: relativePath, text: buffer.toString("utf8") });
    }
  }

  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function encodeGitHubRef(ref: string): string {
  return ref
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isGitHubPathSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && !value.startsWith(".") && !value.endsWith(".");
}
