-- PulseChat schema (SQLite)
-- Applied automatically by db/init.js on first run.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT DEFAULT NULL,
  status        TEXT DEFAULT 'offline',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A conversation is either a 1:1 DM or a named group.
CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  is_group    INTEGER NOT NULL DEFAULT 0,
  name        TEXT,                      -- group name, NULL for DMs
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- kind: 'text' | 'image' | 'audio' | 'video'
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id       INTEGER NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'text',
  body            TEXT,               -- text content (for kind='text')
  file_path       TEXT,               -- /uploads/... (for image/audio/video)
  file_name       TEXT,
  mime_type       TEXT,
  duration_sec    REAL,               -- for audio/video
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
