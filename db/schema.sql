-- MindForum schema. Idempotent — safe to re-run.
-- Versioning: each migration inserts a row into schema_migrations.
-- Keep tables room-scoped; everything cascades from rooms.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version      INTEGER PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  system_prompt   TEXT NOT NULL DEFAULT '',
  created_by_id   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  id         TEXT NOT NULL,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, room_id)
);

-- Prevent duplicate joins when the same user races two join requests
-- before the cookie lands. Email is case-folded at insert time.
CREATE UNIQUE INDEX IF NOT EXISTS participants_room_email_uniq
  ON participants (room_id, lower(email));

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'chat',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_room_created_idx
  ON messages (room_id, created_at);

CREATE TABLE IF NOT EXISTS room_files (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  uploaded_by_id  TEXT NOT NULL,
  extracted_text  TEXT NOT NULL DEFAULT '',
  selected        BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS room_files_room_uploaded_idx
  ON room_files (room_id, uploaded_at);

INSERT INTO schema_migrations (version) VALUES (1)
  ON CONFLICT (version) DO NOTHING;

-- v2: per-participant last_seen_at for catch-up modal
ALTER TABLE participants ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES (2)
  ON CONFLICT (version) DO NOTHING;

-- v3: rolling catch-up summary persisted per room.
-- Avoids re-summarizing the entire conversation on every /catchup call;
-- each call folds the delta (messages since summary_up_to_msg_id) into the
-- existing summary + pinned facts.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS rolling_summary       JSONB;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS pinned_facts          JSONB;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS summary_up_to_msg_id  TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS summary_updated_at    TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES (3)
  ON CONFLICT (version) DO NOTHING;

-- v4: emoji reactions on messages.
-- Composite PK enforces "one reaction of each emoji per (message, participant)".
-- A participant can react with multiple distinct emojis on the same message.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  participant_id  TEXT NOT NULL,
  emoji           TEXT NOT NULL,
  reacted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, participant_id, emoji)
);

CREATE INDEX IF NOT EXISTS message_reactions_msg_idx
  ON message_reactions (message_id);

INSERT INTO schema_migrations (version) VALUES (4)
  ON CONFLICT (version) DO NOTHING;

-- v5: track edits on chat messages so the UI can show "(edited)".
-- AI streaming reuses updateMessageContent without setting edited_at; only
-- explicit author edits stamp this column.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES (5)
  ON CONFLICT (version) DO NOTHING;

-- v6: allowlisted creators. Faculty operators self-serve their own rooms via a
-- per-creator hashed token cookie; super-admin still authenticates via
-- ADMIN_TOKEN. The synthetic 'cr_super_admin' row is a sentinel — its
-- token_hash is unreachable (sha256 never produces all zeros for a real
-- token), so super-admin can never authenticate via the creator-cookie path.
-- The row exists so foreign keys and audit-log entries have a valid actor_id.
CREATE TABLE IF NOT EXISTS allowlisted_creators (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  token_hash        TEXT NOT NULL,
  token_last_four   TEXT NOT NULL,
  token_rotated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_super_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS allowlisted_creators_email_uniq
  ON allowlisted_creators (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS allowlisted_creators_token_hash_uniq
  ON allowlisted_creators (token_hash);

INSERT INTO allowlisted_creators (
  id, email, display_name, token_hash, token_last_four,
  is_super_admin, created_at, created_by
) VALUES (
  'cr_super_admin',
  'super_admin@mindforum.local',
  'Super Admin',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000',
  TRUE, NOW(), 'system'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES (6)
  ON CONFLICT (version) DO NOTHING;

-- v7: room ownership + archive. ON DELETE RESTRICT on owner_id is intentional
-- — deleting a creator with rooms requires explicit transfer or hard-delete.
-- Backfill uses the literal 'cr_super_admin' id (not a subquery) so the
-- migration is rerun-safe and never fails on "0 or >1 super-admin rows".
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS owner_id    TEXT REFERENCES allowlisted_creators(id) ON DELETE RESTRICT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE rooms SET owner_id = 'cr_super_admin' WHERE owner_id IS NULL;
ALTER TABLE rooms ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS rooms_owner_idx    ON rooms (owner_id);
CREATE INDEX IF NOT EXISTS rooms_archived_idx ON rooms (archived_at) WHERE archived_at IS NULL;

INSERT INTO schema_migrations (version) VALUES (7)
  ON CONFLICT (version) DO NOTHING;

-- v8: append-only audit log. No FK on room_id — entries must survive
-- room.hard_delete (snapshot metadata captures slug/name before cascade).
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id    TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  room_id     TEXT,
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_room_idx  ON audit_log (room_id, at DESC);

INSERT INTO schema_migrations (version) VALUES (8)
  ON CONFLICT (version) DO NOTHING;

-- v9: polls — single-choice voting with hidden tallies until close.
-- One row per vote (UPSERT on conflict = change vote, no history).
-- Lazy expiry: status='open' is canonically open iff closes_at IS NULL OR closes_at > NOW().
CREATE TABLE IF NOT EXISTS polls (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL,
  question     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open','closed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at    TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  closed_by    TEXT
);

CREATE INDEX IF NOT EXISTS polls_room_status_idx
  ON polls (room_id, status);

CREATE TABLE IF NOT EXISTS poll_options (
  id        TEXT PRIMARY KEY,
  poll_id   TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL,
  UNIQUE (poll_id, position)
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id        TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  option_id      TEXT NOT NULL REFERENCES poll_options(id),
  cast_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, participant_id)
);

INSERT INTO schema_migrations (version) VALUES (9)
  ON CONFLICT (version) DO NOTHING;

-- v10: admin facilitator state — close a session, mute / remove participants.
-- All three columns nullable; non-NULL means the state is active.
-- (Originally numbered v7 on the polls branch before rebase onto creator-rooms-v1.)
ALTER TABLE rooms        ADD COLUMN IF NOT EXISTS closed_at  TIMESTAMPTZ;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS muted_at   TIMESTAMPTZ;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES (10)
  ON CONFLICT (version) DO NOTHING;
