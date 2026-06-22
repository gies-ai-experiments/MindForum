# MindForum programmatic API (v1)

Allowlisted creators can create rooms and send invites server-to-server using a
personal API key. Mint a key in the dashboard → **API keys** (shown once).

## Auth

Send the key as a bearer token: `Authorization: Bearer mf_sk_…`

A revoked key (by you, or by a super-admin) stops working on the next request.

## POST /api/v1/rooms

Body: `{ "name": string, "systemPrompt"?: string, "id"?: string }`

- `id` is an optional slug (`^[a-z0-9-]{3,40}$`); omit it to auto-generate one.
- `systemPrompt` over the cap (`MAX_SYSTEM_PROMPT_CHARS`) → `400 system_prompt_too_long`.
- `201 { "id", "name" }`; `409 slug_taken`; `400 invalid_slug`; `429 rate_limited`.

The new room is owned by the key's creator.

```bash
curl -X POST https://<host>/api/v1/rooms \
  -H "Authorization: Bearer $MF_KEY" -H "Content-Type: application/json" \
  -d '{"name":"My room","id":"my-room"}'
```

## POST /api/v1/rooms/:id/invitations

You must own the room (else `404 not_found`).

- Single: `{ "inviteeEmail", "inviteeName" }` → `201 <invitation>`.
- Bulk: `{ "invites": [ { "inviteeEmail", "inviteeName" }, … ] }` (max 50) →
  `201 { "created": [...], "skipped": n }` (`skipped` = already-invited duplicates).
- Invite emails send in the background (Azure Communication Services).

```bash
curl -X POST https://<host>/api/v1/rooms/my-room/invitations \
  -H "Authorization: Bearer $MF_KEY" -H "Content-Type: application/json" \
  -d '{"invites":[{"inviteeEmail":"a@x.edu","inviteeName":"A"}]}'
```

## Limits

20 rooms/day per creator; ~200 invites/day per key; 50 invites per bulk request.

## Errors

`{ "error": "<code>" }` with status: 400 (bad input), 401 (missing/invalid/revoked
key), 403 (creator disabled), 404 (room not owned), 409 (conflict), 429 (rate limited).

## Managing keys

- **Self-service:** dashboard → **API keys** — create (revealed once), list, revoke.
- **Super-admin:** `/admin/users` → expand a creator → **Keys** to view/revoke any
  creator's keys.
