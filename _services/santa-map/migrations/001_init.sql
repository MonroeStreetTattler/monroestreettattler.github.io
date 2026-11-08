-- Santa map schema, version 1. SQLite (also valid for Cloudflare D1).
-- Public reads use only the displays table, and only its public columns.

-- One row per Santa display: a property, a season and a category.
-- Repeat reports of the same display never add a row; they update last_reported_on.
CREATE TABLE displays (
  id               INTEGER PRIMARY KEY,
  public_id        TEXT    NOT NULL UNIQUE,
  season           INTEGER NOT NULL,
  category         TEXT    NOT NULL CHECK (category IN ('matching', 'other')),
  property_key     TEXT    NOT NULL,
  address          TEXT    NOT NULL,
  lat              REAL    NOT NULL,
  lon              REAL    NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),
  description      TEXT    CHECK (description IS NULL OR length(description) <= 150),
  status           TEXT    NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  first_reported_on TEXT   NOT NULL,
  last_reported_on  TEXT   NOT NULL,
  report_count     INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  UNIQUE (season, category, property_key)
);
CREATE INDEX displays_season_status ON displays (season, status);

-- Every accepted save attempt, keyed by the browser's idempotency key so a retry
-- returns the first answer. Private: never returned by the public API.
CREATE TABLE submissions (
  id               INTEGER PRIMARY KEY,
  idempotency_key  TEXT    NOT NULL UNIQUE,
  display_id       INTEGER NOT NULL REFERENCES displays (id),
  outcome          TEXT    NOT NULL CHECK (outcome IN ('created', 'confirmed', 'review')),
  category         TEXT    NOT NULL,
  quantity         INTEGER NOT NULL,
  description      TEXT,
  entered_address  TEXT    NOT NULL,
  response_json    TEXT    NOT NULL,
  created_at       TEXT    NOT NULL
);

-- Correction and removal requests, plus conflicting reports, for the editor.
-- Private: only the authenticated editor API reads this table.
CREATE TABLE corrections (
  id                INTEGER PRIMARY KEY,
  display_id        INTEGER NOT NULL REFERENCES displays (id),
  kind              TEXT    NOT NULL CHECK (kind IN ('location', 'removed', 'quantity', 'category', 'other', 'conflicting_report', 'hidden_rereport')),
  message           TEXT    CHECK (message IS NULL OR length(message) <= 500),
  proposed_quantity INTEGER CHECK (proposed_quantity IS NULL OR proposed_quantity BETWEEN 1 AND 10),
  status            TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution        TEXT,
  created_at        TEXT    NOT NULL,
  resolved_at       TEXT
);
CREATE INDEX corrections_status ON corrections (status);

-- Every editor change, with the display before and after. Nothing is deleted.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  display_id  INTEGER,
  correction_id INTEGER,
  before_json TEXT,
  after_json  TEXT
);

-- Geocoder answers, so the same address is looked up once.
CREATE TABLE geocode_cache (
  query_key   TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Request counts per client per window. client_key is a keyed hash, never an IP address.
CREATE TABLE rate_counts (
  bucket       TEXT    NOT NULL,
  client_key   TEXT    NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (bucket, client_key, window_start)
);
