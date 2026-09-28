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
  device TEXT,                -- phone | tablet | desktop
  campaign TEXT               -- which link brought the visit: brytonzoz.com/go/<code> or ?ref=<code>
);
CREATE INDEX IF NOT EXISTS events_type_day ON events (type, day);
CREATE INDEX IF NOT EXISTS events_play ON events (play);
CREATE INDEX IF NOT EXISTS events_track ON events (track);
CREATE INDEX IF NOT EXISTS events_campaign ON events (campaign);

-- Who is listening right now (one row per browser, refreshed while music plays).
CREATE TABLE IF NOT EXISTS live (
  visitor TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  track TEXT
);

-- The "Notify me" list (exported from /admin as CSV).
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  source TEXT,                -- where they signed up, e.g. teaser
  campaign TEXT,
  country TEXT,
  visitor TEXT
);

-- Scrapwrk: every piece is 1 of 1. 'held' while someone is in Stripe Checkout (until held_until),
-- 'sold' once paid. Managed by worker/store.ts; rows are created on first use.
CREATE TABLE IF NOT EXISTS store_items (
  product_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'available',
  session_id TEXT,
  held_until INTEGER,
  sold_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS store_items_session ON store_items (session_id);
