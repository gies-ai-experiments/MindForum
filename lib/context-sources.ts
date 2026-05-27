import type { RoomFile } from "./store";

export const SOURCE_TYPES = ["upload", "github", "url"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type GitHubSourceMeta = {
  owner: string;
  repo: string;
  ref: string;
  include: string[];
  exclude: string[];
  fileCount: number;
  charCount: number;
};

export type UrlSourceMeta = {
  instruction: string;
  contentType: string;
  originalLength: number;
  readableLength: number;
  extractedLength: number;
  model: string;
};

export type SourceMeta = GitHubSourceMeta | UrlSourceMeta | null;

export const DEFAULT_GITHUB_INCLUDE = [
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

export const DEFAULT_GITHUB_EXCLUDE = [
  "node_modules/**",
  ".git/**",
  "*.lock",
  "dist/**",
  "build/**",
  ".next/**",
  "coverage/**",
];

export const MAX_CONTEXT_CHARS = 200_000;
export const MAX_URL_BYTES = 5 * 1024 * 1024;
export const ATTACH_RATE = { bucket: "attach", limit: 10, windowMs: 10 * 60 * 1000 } as const;

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && SOURCE_TYPES.includes(value as SourceType);
}

export function publicRoomFile(file: RoomFile) {
  const { extractedText: _dropText, selected: _dropSelected, ...publicFile } = file;
  return publicFile;
}
