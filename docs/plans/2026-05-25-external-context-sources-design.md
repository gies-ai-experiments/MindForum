# External Context Sources — v1 Design

**Branch:** `external-context-sources` (off `main` at `e7f0b6d`)
**Date:** 2026-05-25
**Status:** Draft — pending implementation plan via writing-plans skill

## 1. Goal & non-goals

**Goal.** Let any participant in a MindForum room attach two new kinds of context alongside file uploads, so that `@ai` replies and the project brief consume them the same way they consume uploaded files:

- **GitHub repo** (public only): paste a URL + optional include/exclude glob → the repo is flattened into one virtual file.
- **Web URL** (single page) + brief instruction: paste a URL + one-line instruction (e.g. *"just the methodology section"*) → page is fetched, an LLM extracts per the instruction, the result is stored as a virtual file.

**Non-goals (v1).** Private repos, multi-hop crawling, scheduled re-fetching, vector/RAG retrieval, per-file selection within a repo, per-creator cost tracking for the extraction call (that lives in the separately-roadmapped per-creator-OpenAI-keys v2).

## 2. UX

The existing upload menu in the chat composer grows from one option to three:

```
📎 Attach…
   ├─ 📄 Upload file
   ├─ 🐙 Attach GitHub repo     ← new
   └─ 🔗 Scrape a URL           ← new
```

Each opens a small modal:

- **GitHub repo modal.** URL field, optional `include` glob, optional `exclude` glob, "Preview" button (shows file count and total chars before commit), "Attach" button. Defaults: `include = **/*.md, **/*.py, **/*.ts, **/*.tsx, **/*.js, **/*.jsx, **/*.json, **/*.txt, **/*.rst, **/*.toml, **/*.yaml, **/*.yml`; `exclude = node_modules/**, .git/**, *.lock, dist/**, build/**, .next/**, coverage/**`.
- **URL modal.** URL field, single-line `instruction` field with placeholder *"e.g. just the methodology section / list of contributors / abstract only"*, "Attach" button.

Both surface as a new row in the Files panel with a small badge identifying the source type (`github`, `url`, vs. plain `file`). Hover or click the badge shows the source URL and the glob or instruction. The existing per-row `selected` toggle, attribution ("attached by Alice"), and Files-panel delete (creator-only) work unchanged.

## 3. Architecture

Both new sources funnel into the same `room_files` row shape as existing uploads, so the prompt-assembly pipe (`fileBlock(files)` in `lib/openai.ts`) needs no changes. Existing AI surfaces (`chatReplyStream`, `generateBrief`, `draftPollFromHistory`, `summarizeForCatchup`) consume the new sources transparently.

### Data flow

```
Chat composer
  │
  ├── Upload file ──────────→ POST /api/room/[id]/upload          (existing)
  ├── Attach repo ──────────→ POST /api/room/[id]/context/github  (new)
  └── Scrape URL  ──────────→ POST /api/room/[id]/context/url     (new)
                                          │
                                          ▼
                          lib/ingest/github.ts        lib/ingest/url.ts
                          ─────────────────────       ──────────────────
                          1. validate URL             1. validate URL (SSRF block)
                          2. fetch via GitHub API     2. fetch (Playwright if HTML/JS,
                             (tarball download)         plain fetch if PDF/MD)
                          3. apply globs +            3. Readability strip
                             skip binaries            4. LLM extract per instruction
                          4. concat with              5. emit { name, extractedText,
                             `--- FILE: path ---`        meta }
                             headers
                          5. emit { name, extractedText, meta }
                                          │
                                          ▼
                          INSERT INTO room_files (source_type, source_url, source_meta, ...)
                                          │
                                          ▼
                          SSE broadcast → Files panel refresh
                                          │
                                          ▼
                          Next @ai reply / brief picks it up via existing fileBlock()
```

### What changes vs. what doesn't

| Touched | Untouched |
|---|---|
| Two new routes: `POST /api/room/[id]/context/github`, `POST /api/room/[id]/context/url` | `chatReplyStream`, `generateBrief`, `draftPollFromHistory`, `summarizeForCatchup` |
| Two new modules: `lib/ingest/github.ts`, `lib/ingest/url.ts` | `fileBlock()` in `lib/openai.ts` |
| One schema migration (v11) extending `room_files` | `MAX_FILE_CHARS` (still 200,000) |
| Chat composer upload menu | Files panel rendering (just gets a new badge) |
| SSE broadcast already covers new `room_files` rows | Existing per-IP rate-limit infrastructure |

## 4. Data model

One additive migration, next free version (currently at v10 in `db/schema.sql` after polls v9 + admin facilitator v10):

```sql
-- v11: external context sources (github / url) attach as room_files rows
ALTER TABLE room_files
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'upload'
    CHECK (source_type IN ('upload', 'github', 'url'));
ALTER TABLE room_files
  ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE room_files
  ADD COLUMN IF NOT EXISTS source_meta JSONB;

INSERT INTO schema_migrations (version) VALUES (11)
  ON CONFLICT (version) DO NOTHING;
```

**`source_meta` shape by type:**

- `github`: `{ "owner": "...", "repo": "...", "ref": "<sha-or-tag>", "include": "...", "exclude": "...", "fileCount": 42 }`
- `url`: `{ "instruction": "...", "originalLength": 18234, "extractedLength": 2104, "model": "gpt-5.4-mini" }`
- `upload`: `null`

Existing rows backfill to `source_type='upload'` via the column default — rerun-safe.

`extracted_text` keeps its existing role for all three types. The `selected` toggle, attribution via `uploaded_by_id`, and `ON DELETE CASCADE` from `rooms` all work as-is.

## 5. Cost & safety

| Concern | Mitigation |
|---|---|
| SSRF (URL scrape hits internal IPs) | Resolve hostname first; reject loopback, private (`10/8`, `172.16/12`, `192.168/16`, `fd00::/8`), link-local (`169.254/16`), cloud metadata (`169.254.169.254`). Reject non-HTTP(S) schemes. |
| Repo too large | Hard cap **200,000 chars** on flattened text (matches existing `MAX_FILE_CHARS`). Preview shows running total; "Attach" disabled if over. Truncation never silent — server returns `413 too_large` with the byte count. |
| URL fetch hangs / huge page | 30s timeout, 5MB response cap before extraction. |
| Abuse (one participant spams 50 attaches) | Extend existing per-IP `upload` limit (10 / 10min) to a combined `context` bucket covering all three attach routes (`upload`, `github`, `url`). |
| LLM extraction cost | One `gpt-5.4-mini` call per URL scrape (≈ $0.001). Repo attach uses **no** LLM (pure concat). Audit log records every attach. |
| Public-repo TOS | GitHub REST API rate limit (60/hr unauthenticated) is plenty for v1. If hit, route returns `429 rate_limited`. No token required. |
| Attribution | Reuse existing `uploaded_by_id`. Files panel says "Repo attached by Alice"; deletes (creator-only) work unchanged. |
| Audit | New event: `room.context_added` with `{source_type, source_url, attached_by}`. Emitted via existing `logAudit()`. |

## 6. Testing

- **Unit / pure logic.** `lib/ingest/github.ts` — glob matching, binary-file detection, size accumulator (Node `--test`). Pattern follows the existing `.mjs` test files but **with `.ts` extensions on relative imports** per the 2026-05-13 learning (`lib/poll-store.test.mjs` fails on Node 25 due to extensionless imports).
- **Unit.** `lib/ingest/url.ts` — SSRF guard table-test covering IPv4 (`127.0.0.1`, `10.0.0.1`, `192.168.1.1`, `169.254.169.254`), IPv6 (`::1`, `fd00::1`), and hostnames that resolve to internal IPs.
- **Integration.** Real fetch against a small known-good public repo (`octocat/Hello-World`) and a small known-good URL (`example.com`); assert resulting `room_files` row shape, `source_type`, `source_meta`.
- **No mocking the LLM extraction call** in tests — gate behind `OPENAI_API_KEY` env, skip if absent. Integration tests must hit real services (per existing project convention).

## 7. v2 / out of scope

Tracked but explicitly not in v1:

- Private repos via GitHub App install.
- Scheduled refresh (cron or per-row "Refresh now" button); v1 = refresh by re-attaching manually.
- Multi-hop crawl from a URL.
- Per-file selection within a repo (each repo file as its own `room_files` row).
- Embeddings / RAG for large repos.
- Per-creator cost cap on the LLM extraction call (lives in the broader per-creator-OpenAI-keys v2 work).

## 8. Open items resolved during brainstorming

1. **Scrape semantics.** User pastes a URL + brief natural-language instruction; agent fetches that one page (no link-following) and the instruction shapes ingest-time LLM extraction.
2. **GitHub access.** Public repos only in v1; no auth, no tokens.
3. **Repo ingestion model.** Flatten with include/exclude glob → one virtual file per repo (one `room_files` row). Reuses the existing `selected` toggle and prompt pipe; keeps the Files panel uncluttered.
4. **Who can attach.** Any participant, via the chat composer upload menu — same trust model as today's file uploads.
5. **Scrape mechanism.** Fetch one page + LLM-extract per instruction at ingest time. Predictable per-attach cost; the AI sees a tight, focused doc; the room AI doesn't re-pay per-reply tokens for an unfiltered page.

## 9. Acceptance checklist (to be walked end-to-end before merge)

1. Migration v11 applies cleanly on a fresh DB and on a DB with existing `upload` rows; rerun-safe.
2. From the chat composer, the upload menu shows three options.
3. Attaching `github.com/octocat/Hello-World` with no globs flattens the repo into one `room_files` row with `source_type='github'` and a sane `source_meta.fileCount`.
4. Attaching a 500-file repo with `include=**/*.md` returns only the markdown files in the flattened blob; total chars ≤ 200,000 (else `413 too_large`).
5. Scraping `https://example.com` with instruction `"just the heading and first paragraph"` produces a `room_files` row with `source_type='url'`, `extracted_text` reflecting only the requested slice, and `source_meta.instruction` preserved.
6. SSRF guard rejects `http://127.0.0.1`, `http://169.254.169.254`, `http://10.0.0.1` with `400 invalid_url`.
7. Per-IP combined rate limit: 11th attach within 10 min (any of the three routes) returns `429 rate_limited`.
8. Next `@ai` reply after attach includes content from the new source (verified by an `@ai` question only answerable from the attached content).
9. Project brief regeneration after attach incorporates the new source.
10. Audit log shows `room.context_added` rows with the right `source_type`, `source_url`, `attached_by`.
11. Files panel shows source-type badges; clicking expands to show URL + glob/instruction.
12. Creator-only delete works on `github` and `url` rows the same as on `upload` rows.

---

**Next step.** Hand off to `superpowers:writing-plans` to break this design into an ordered implementation plan with file-level tasks, test gates, and Codex Plan Reviewer rounds.
