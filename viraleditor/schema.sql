PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('produce','prepare','scan','edit')),
  ref         TEXT NOT NULL,                 -- produce: the site's job id · prepare, edit: template id · scan: scan id
  state       TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('held','queued','running','done','stopped','closed')),   -- held: handed over by the site and not released yet; the worker never claims or takes over a held run
  input       TEXT NOT NULL,                 -- JSON: RunInput of the kind
  approved    TEXT,                          -- produce: JSON Paid, every paid request the customer has confirmed so far
  sent        TEXT,                          -- produce: JSON Paid, every paid request submitted so far (the worker counts)
  missing     TEXT,                          -- produce, when stopped: JSON Paid a resume would have to pay for
  steps       TEXT NOT NULL DEFAULT '[]',    -- produce: JSON Step[]
  variants    TEXT NOT NULL DEFAULT '[]',    -- produce: JSON VariantState[], written by the worker as each variant goes on (a finished variant is delivered even when another one stopped)
  result      TEXT,                          -- JSON: RunResult of the kind, when done
  reason      TEXT,                          -- machine code, when stopped
  detail      TEXT,                          -- allowlisted diagnostic code only, never raw error text
  takeovers   INTEGER NOT NULL DEFAULT 0,    -- stale-owner recoveries, excludes voluntary hand-back
  claimed_by  TEXT,
  heartbeat   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_once ON runs (kind, ref) WHERE kind IN ('produce','scan');
CREATE INDEX IF NOT EXISTS runs_queue ON runs (state, created_at);

CREATE TABLE IF NOT EXISTS operations (     -- one row per paid request, written BEFORE the request is sent
  run_id        TEXT NOT NULL REFERENCES runs(id),
  key           TEXT NOT NULL,              -- 'v1:image:s1', 'v1:image:presenter', 'v1:clip:s1', 'v1:music', 'v1:voice'; a resend after a failed row: '<key>#2'
  kind          TEXT NOT NULL CHECK (kind IN ('image','clip','music','voice')),
  state         TEXT NOT NULL CHECK (state IN ('pending','done','failed','unknown')),
  external_id   TEXT,                       -- the Generator's ticket; NULL until the provider has accepted the request
  output        TEXT,                       -- the downloaded file, relative to data/
  error         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (run_id, key)
);

CREATE TABLE IF NOT EXISTS templates (
  id              TEXT PRIMARY KEY,
  state           TEXT NOT NULL CHECK (state IN ('preparing','ready','failed','published','hidden')),
  owner           TEXT,                     -- site user id of a private template; NULL for the shared catalog
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('topads','shorts','link','upload','seed')),
  source_url      TEXT,
  note            TEXT,                     -- machine code, when failed
  card            TEXT NOT NULL,            -- JSON Card: everything the site shows
  estimate        TEXT,                     -- JSON Paid for ONE variant; NULL until ready
  minutes         INTEGER,                  -- minutes one variant takes
  sample_changed_at TEXT,                   -- latest shot edit not reflected in the current sample; site freshness survives run retention
  times_generated INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id          TEXT PRIMARY KEY,
  scan_id     TEXT,
  source      TEXT NOT NULL CHECK (source IN ('topads','shorts','manual')),
  url         TEXT NOT NULL UNIQUE,         -- the dedupe key across scans
  title       TEXT NOT NULL,
  views       INTEGER,
  likes       INTEGER,
  seconds     REAL NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('found','scored','unsupported','rejected','prepared')),
  score       INTEGER,
  score_notes TEXT,
  image       TEXT,
  video       TEXT,                         -- a direct video file to download instead of url (Top Ads), or NULL
  found_at    TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('topads','shorts')),
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  checked         INTEGER NOT NULL DEFAULT 0,
  queued          INTEGER NOT NULL DEFAULT 0,           -- candidates the scan sent on to scoring (prepare runs it queued, re-queues included)
  above_threshold INTEGER NOT NULL DEFAULT 0,
  prepared        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('running','done','stopped')),
  reason          TEXT
);

CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);   -- JSON Settings
CREATE TABLE IF NOT EXISTS health   (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);   -- JSON Health, written by the worker
-- The provider refused a paid request for its credits (HTTP 402): while the row is there no run sends a new one (robust/provider-credits.ts)
CREATE TABLE IF NOT EXISTS provider_hold (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL, run_id TEXT NOT NULL, key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage (
  day   TEXT NOT NULL,                      -- YYYY-MM-DD, local time
  kind  TEXT NOT NULL CHECK (kind IN ('score','prepare')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
