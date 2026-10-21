-- Drip's database (Cloudflare D1). Only what it takes to show what people wear:
-- no passwords, no emails, no IP addresses.
-- npx wrangler d1 execute drip --remote --file schema.sql

CREATE TABLE IF NOT EXISTS squads (
  code       TEXT PRIMARY KEY,               -- WOLF-7Q2K
  name       TEXT NOT NULL,                  -- shown under the name tag
  emblem     TEXT NOT NULL,                  -- wolf, crown, flame, star...
  color_a    TEXT NOT NULL,                  -- #rrggbb
  color_b    TEXT NOT NULL,
  owner      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,               -- the session server's player id, 32 hex digits
  name       TEXT NOT NULL,
  squad      TEXT REFERENCES squads(code),
  founder    INTEGER NOT NULL DEFAULT 0,     -- connected in the first month
  first_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wearing (
  player_id  TEXT PRIMARY KEY REFERENCES players(id),
  cape       TEXT,                           -- catalog id, or u/<id> for a custom cape
  wings      TEXT,
  hat        TEXT,
  pet        TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capes (
  id         TEXT PRIMARY KEY,               -- the image is capes/<id> in R2
  owner      TEXT NOT NULL REFERENCES players(id),
  format     TEXT NOT NULL CHECK (format IN ('png', 'jpeg', 'gif')),
  frames     INTEGER NOT NULL DEFAULT 1,     -- up to 32
  bytes      INTEGER NOT NULL,               -- up to 524288
  hidden     INTEGER NOT NULL DEFAULT 0,     -- 1 after 3 reports, until a volunteer reviews it
  created_at INTEGER NOT NULL
);

-- One row per player per cape, so reporting twice counts once.
CREATE TABLE IF NOT EXISTS reports (
  cape_id    TEXT NOT NULL REFERENCES capes(id),
  reporter   TEXT NOT NULL REFERENCES players(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (cape_id, reporter)
);

CREATE INDEX IF NOT EXISTS players_by_squad ON players (squad);

-- A volunteer who reviewed a hidden cape and found it fine:
--   UPDATE capes SET hidden = 0 WHERE id = '<id>'; DELETE FROM reports WHERE cape_id = '<id>';
