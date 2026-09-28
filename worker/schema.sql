-- Listening metrics (Cloudflare D1: brytonzoz-metrics, and brytonzoz-metrics-staging for staging).
-- Anonymous: a random id per browser (no cookies, no names, no IP addresses stored).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,        -- epoch ms
  day TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  type TEXT NOT NULL,         -- view | play | listen | share | outbound | open
  visitor TEXT,               -- random id per browser
  session TEXT,               -- random id per visit
  play TEXT,                  -- random id per play of a song (listen segments of one play share it)
  release TEXT,               -- e.g. solenya
  track TEXT,                 -- e.g. solenya/4
  seconds REAL,               -- listen: seconds actually heard in this segment
  position REAL,              -- listen: furthest point reached, 0..1
  detail TEXT,                -- listen: ended|skip|pause|switch|leave; outbound: service; share: method; view: path
  referrer TEXT,              -- host that sent the visitor
  country TEXT,
  device TEXT                 -- phone | tablet | desktop
);
CREATE INDEX IF NOT EXISTS events_type_day ON events (type, day);
CREATE INDEX IF NOT EXISTS events_play ON events (play);
CREATE INDEX IF NOT EXISTS events_track ON events (track);

-- Who is listening right now (one row per browser, refreshed while music plays).
CREATE TABLE IF NOT EXISTS live (
  visitor TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  track TEXT
);
