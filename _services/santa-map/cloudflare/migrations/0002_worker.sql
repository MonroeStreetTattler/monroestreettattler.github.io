-- Worker/D1 additions. 0001_init.sql is an exact copy of ../migrations/001_init.sql.

-- snapshot_version goes up with every change to displays, so a public read can check one
-- row and reuse a snapshot it already built.
CREATE TABLE meta (
  key   TEXT    PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('snapshot_version', 0);

-- The last public snapshot built for each season, with the snapshot_version it was built
-- from. The first Worker instance to rebuild after a change stores it here; the others read
-- this one row instead of every display. Public data only.
CREATE TABLE snapshots (
  season  INTEGER PRIMARY KEY,
  version INTEGER NOT NULL,
  body    TEXT    NOT NULL
);

-- The public totals (sum of quantity over visible displays) per season and category, kept
-- by the triggers below in the same transaction as every change to displays, so reading
-- them costs two rows instead of a pass over every display.
CREATE TABLE season_totals (
  season   INTEGER NOT NULL,
  category TEXT    NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season, category)
);
INSERT INTO season_totals (season, category, quantity)
  SELECT season, category, SUM(CASE WHEN status = 'visible' THEN quantity ELSE 0 END) FROM displays GROUP BY season, category;

CREATE TRIGGER displays_after_insert AFTER INSERT ON displays
BEGIN
  INSERT INTO season_totals (season, category, quantity)
    VALUES (NEW.season, NEW.category, CASE WHEN NEW.status = 'visible' THEN NEW.quantity ELSE 0 END)
    ON CONFLICT (season, category) DO UPDATE SET quantity = quantity + excluded.quantity;
  UPDATE meta SET value = value + 1 WHERE key = 'snapshot_version';
END;

CREATE TRIGGER displays_after_update AFTER UPDATE ON displays
BEGIN
  UPDATE season_totals SET quantity = quantity - CASE WHEN OLD.status = 'visible' THEN OLD.quantity ELSE 0 END
    WHERE season = OLD.season AND category = OLD.category;
  INSERT INTO season_totals (season, category, quantity)
    VALUES (NEW.season, NEW.category, CASE WHEN NEW.status = 'visible' THEN NEW.quantity ELSE 0 END)
    ON CONFLICT (season, category) DO UPDATE SET quantity = quantity + excluded.quantity;
  UPDATE meta SET value = value + 1 WHERE key = 'snapshot_version';
END;

-- Displays are never deleted by the service; this keeps the totals right if one ever is.
CREATE TRIGGER displays_after_delete AFTER DELETE ON displays
BEGIN
  UPDATE season_totals SET quantity = quantity - CASE WHEN OLD.status = 'visible' THEN OLD.quantity ELSE 0 END
    WHERE season = OLD.season AND category = OLD.category;
  UPDATE meta SET value = value + 1 WHERE key = 'snapshot_version';
END;

-- Lookups that every save and the daily clean-up make.
CREATE INDEX corrections_display_kind ON corrections (display_id, kind, status);
CREATE INDEX rate_counts_window ON rate_counts (window_start);
