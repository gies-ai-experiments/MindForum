# External Context Sources - v1 Design

**Source:** revised from PR #16 (`external-context-sources`)  
**Revision date:** 2026-05-27  
**Status:** Revised design, ready for implementation planning

## 1. Review Notes From PR #16

The original draft had the right product direction: treat public GitHub repositories and single web pages as attachable room context, stored beside uploaded files so participants can select them for AI use.

This revision tightens the parts that were either too broad or mismatched with current MindForum behavior:

- **Full-content AI consumers:** `@ai` replies and project briefs use selected file contents through `getSelectedFiles()` and `fileBlock()`. These should consume GitHub and URL context transparently once the new rows are mapped as `RoomFile`s.
- **Metadata-only or chat-only consumers:** catch-up summaries currently see selected file names only through `getRoomCatchupContext()`. Poll drafting currently sees recent chat and room guidance only through `draftPollFromHistory()`. v1 should not claim those use full source contents unless the implementation explicitly changes them.
- **Current delete model:** room participants can attach files, but owner/super-admin deletion lives in the dashboard and file route. v1 should keep that model instead of adding participant-owned delete behavior inside the room.
- **Current Files surfaces:** source metadata must appear in the live room Files panel, the file preview modal, and the creator dashboard file table.
- **URL safety:** v1 should avoid browser automation. Use server-side fetch with strict URL, DNS, redirect, size, and timeout guards. Dynamic JavaScript-heavy pages are out of scope for v1.
- **Audit language:** external context should produce audit rows using the existing audit system. The easiest v1 path is to keep `file.upload` and include `sourceType`, `sourceUrl`, and source-specific metadata.

## 2. Goal and Non-Goals

**Goal.** Let any active room participant attach two new kinds of selected AI context alongside file uploads:

- **Public GitHub repository:** participant pastes a GitHub repository URL plus optional include/exclude globs. MindForum fetches the public repo, filters text-like files, flattens the selected content into one virtual file, and stores it as one `room_files` row.
- **Single web URL:** participant pastes an HTTP(S) URL plus a short extraction instruction. MindForum fetches the page or document, extracts readable text, uses the LLM once to narrow it according to the instruction, and stores the result as one `room_files` row.

Both source types appear in the Files panel, are selected by default, can be toggled in/out of AI context, can be previewed, and are included in the next `@ai` reply or project brief when selected.

**Non-goals for v1.**

- Private repositories or GitHub authentication.
- Crawling multiple pages from a website.
- Scheduled refresh or "refresh now" actions.
- Vector search, embeddings, or RAG.
- Per-file selection within an attached repository.
- Per-creator spend caps for extraction calls.
- Browser automation or JavaScript rendering for scraped URLs.
- Making poll drafting consume attached source text.
- Making catch-up summaries consume attached source text instead of source names.

## 3. UX

The current room Files panel has a single `+ Upload file` control. Replace it with an `Attach` control that opens three choices:

```text
Attach
- Upload file
- Attach GitHub repo
- Scrape URL
```

### GitHub Repo Modal

Fields:

- Repository URL, required. Accepted examples:
  - `https://github.com/octocat/Hello-World`
  - `https://github.com/octocat/Hello-World/tree/main`
- Include globs, optional. Default:
  - `**/*.md, **/*.py, **/*.ts, **/*.tsx, **/*.js, **/*.jsx, **/*.json, **/*.txt, **/*.rst, **/*.toml, **/*.yaml, **/*.yml`
- Exclude globs, optional. Default:
  - `node_modules/**, .git/**, *.lock, dist/**, build/**, .next/**, coverage/**`

Behavior:

- `Preview` fetches the repo file list and returns file count plus estimated flattened character count.
- `Attach` stores the flattened text as one virtual file.
- If flattened text exceeds 200,000 characters, the server rejects with `413 too_large`; do not silently truncate repository context.

### URL Modal

Fields:

- URL, required.
- Instruction, required. Example: `just the methodology section`.

Behavior:

- `Attach` fetches exactly one URL after safety checks.
- HTML pages are reduced with Readability-style extraction before the LLM call.
- PDF, text, and markdown responses are parsed with the same text-extraction path as file uploads where practical.
- The LLM produces the stored `extracted_text` according to the participant's instruction.
- Dynamic pages that require JavaScript rendering are not supported in v1; return a clear error if the readable text is empty or too small.

### Files Panel and Preview

Every file row shows:

- Checkbox for selected/unselected.
- Name.
- Source badge: `file`, `github`, or `url`.
- Attribution: uploader name and date.

Clicking the filename opens the existing preview modal. The preview modal should also show:

- Source type.
- Source URL for GitHub and URL attachments.
- GitHub include/exclude globs when relevant.
- URL instruction when relevant.

The creator dashboard settings file table should show the same source badge and source URL/instruction summary. Owner/super-admin delete remains there.

## 4. Data Model

Add v11 to `db/schema.sql`, after v10:

```sql
-- v11: external context sources attach as room_files rows.
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

Existing rows become `source_type='upload'`. New rows use:

```json
{
  "source_type": "github",
  "source_url": "https://github.com/owner/repo/tree/main",
  "source_meta": {
    "owner": "owner",
    "repo": "repo",
    "ref": "main",
    "include": ["**/*.md", "**/*.ts"],
    "exclude": ["node_modules/**"],
    "fileCount": 42,
    "charCount": 184200
  }
}
```

```json
{
  "source_type": "url",
  "source_url": "https://example.com/report",
  "source_meta": {
    "instruction": "just the methodology section",
    "contentType": "text/html",
    "originalLength": 18234,
    "readableLength": 8400,
    "extractedLength": 2104,
    "model": "gpt-5.4-mini"
  }
}
```

`RoomFile`, public room snapshots, file preview responses, dashboard file rows, and audit metadata all need to include these fields.

## 5. Architecture

### Data Flow

```text
Room Files panel
  |
  |-- Upload file       -> POST /api/room/[id]/upload              (existing, updated bucket)
  |-- Attach repo       -> POST /api/room/[id]/context/github      (new)
  |-- Scrape URL        -> POST /api/room/[id]/context/url         (new)
                                 |
                                 v
                         lib/ingest/github.ts
                         lib/ingest/url.ts
                                 |
                                 v
                         room_files row with source metadata
                                 |
                                 v
                         audit row + SSE file_added event
                                 |
                                 v
                         Files panel, preview modal, AI surfaces
```

### AI Surface Behavior

| Surface | v1 behavior |
|---|---|
| `@ai` replies | Uses full selected external context through `getSelectedFiles()` and `fileBlock()` with no OpenAI route change beyond source fields flowing through `RoomFile`. |
| Project brief | Uses full selected external context through `getSelectedFiles()` and `fileBlock()` with no brief route change beyond source fields flowing through `RoomFile`. |
| Catch-up summary | Uses selected source names only, matching current file behavior and keeping catch-up cost bounded. |
| Poll drafting | Remains chat-history based. It does not consume attached file text in v1. |
| File preview | Shows stored extracted text and source metadata on demand. |

### Shared Attachment Helper

The new context routes and existing upload route should share a small helper for the repeated "persist file-like context" steps:

1. Create a `RoomFile` object.
2. Insert it through `addFile()`.
3. Write an audit row.
4. Broadcast `file_added`.
5. Broadcast current selected file IDs.
6. Return the public file payload.

This avoids copy/paste drift across upload, GitHub, and URL sources.

## 6. Safety and Limits

| Concern | v1 mitigation |
|---|---|
| SSRF through URL scrape | Accept only `http:` and `https:`. Resolve hostnames before fetch. Reject loopback, private, link-local, multicast, and cloud metadata IP ranges for IPv4 and IPv6. Re-check every redirect target. Limit redirects to 3. |
| Redirect abuse | Use manual redirect handling; validate the next URL before following it. |
| URL response too large | Read at most 5 MB before extraction; abort and return `413 too_large` if exceeded. |
| URL fetch hangs | Use a 30 second timeout. |
| Empty or dynamic URL pages | Return `422 no_readable_text` when readable text is too short after extraction. |
| Prompt injection in attached content | Label all extracted source content as untrusted context in `fileBlock()` or source headers. The AI should use it as evidence, not instruction. |
| Large repositories | Hard cap flattened text at 200,000 characters. No silent truncation in v1. |
| Binary files in repositories | Skip binary extensions and files with null bytes or low text ratio. |
| Abuse | Use one shared `attach` rate-limit bucket: 10 attachments per 10 minutes per IP across upload, GitHub, and URL. |
| LLM cost | One extraction call per URL attachment only. GitHub attachments do not call the LLM. |
| GitHub API limits | Public repos only. Use unauthenticated public fetches in v1; return `429 rate_limited` if GitHub rate limits the request. |
| Archived or closed rooms | Match upload behavior: reject attachments in archived or closed rooms. |

## 7. Dependencies

Add only the dependencies needed for the chosen v1 approach:

- `minimatch` for include/exclude matching.
- `tar` for reading GitHub tarballs.
- `@mozilla/readability` and `jsdom` for HTML text extraction.

Do not add Playwright in v1.

## 8. Testing Strategy

Use Node's built-in test runner, matching the current `.test.mjs` pattern.

Required tests:

- GitHub URL parsing.
- GitHub include/exclude glob filtering.
- Binary-file rejection.
- Flattening size accumulator and `too_large` behavior.
- SSRF guard table for IPv4, IPv6, localhost hostnames, and redirect targets.
- URL content-type handling for HTML, markdown/text, and PDF-like buffers where practical.
- Store mapping for `source_type`, `source_url`, and `source_meta` on `RoomFile`.
- Route behavior through local smoke tests; pure network logic should be tested with injected fetch/resolver/model dependencies.
- Manual browser verification for modal and Files panel behavior.

Integration tests that call real GitHub, real URLs, or OpenAI should be opt-in behind environment variables so normal local verification is deterministic and cheap.

## 9. Acceptance Checklist

1. Migration v11 applies cleanly on a fresh database and on a database with existing uploaded files.
2. Existing uploads still work and receive `source_type='upload'`.
3. The room Files panel offers Upload file, Attach GitHub repo, and Scrape URL.
4. Attaching `https://github.com/octocat/Hello-World` stores one selected `room_files` row with `source_type='github'`.
5. GitHub include/exclude globs affect the flattened repo contents as shown by preview and stored text.
6. Oversized GitHub context returns `413 too_large` before inserting a row.
7. Scraping `https://example.com` with a narrow instruction stores one selected `source_type='url'` row.
8. URL SSRF guard rejects loopback, private, link-local, metadata, and unsafe redirect targets.
9. The shared attach rate limit returns `429 rate_limited` on the 11th upload/GitHub/URL attachment in 10 minutes.
10. The next `@ai` reply can answer a question that requires the attached GitHub or URL context.
11. A generated project brief incorporates the attached GitHub or URL context when selected.
12. Catch-up summaries list source names only and do not pull full source text.
13. Poll drafting behavior is unchanged.
14. Room Files panel, file preview modal, and dashboard file table show source badges and source metadata.
15. Owner/super-admin delete works for upload, GitHub, and URL rows.
16. Audit log records the attachment with source type, source URL, actor, file ID, and file name.

## 10. Deferred v2 Ideas

- GitHub App support for private repositories.
- Scheduled refresh and manual refresh.
- Multi-page site crawl.
- Per-file rows for repositories.
- Source diffing between refreshes.
- Embeddings/RAG for large repositories.
- Per-creator extraction budgets.
- Optional poll-drafting mode that reads selected source text.
- Browser-rendered URL scrape for JavaScript-heavy pages.
