-- Recovery: snapshot_version becomes a random token instead of a counter.
--
-- A counter can come back to a value it had before: after D1 Time Travel or a restore
-- rolls the database back from version 9 to 2, two more changes make it 4 again, with
-- different data. A Worker instance still holding its snapshot of the old version 4 would
-- then serve it. A random token names one exact state of the database: a rolled-back
-- database carries the token of the state it returned to, and every later change makes a
-- token that never existed before. The Worker reuses a snapshot only when its token is
-- exactly the current one.
--
-- Only the three triggers change; no table or column does. The token is kept below 2^53 so
-- JavaScript reads it exactly.

DROP TRIGGER displays_after_insert;
DROP TRIGGER displays_after_update;
DROP TRIGGER displays_after_delete;

CREATE TRIGGER displays_after_insert AFTER INSERT ON displays
BEGIN
  INSERT INTO season_totals (season, category, quantity)
    VALUES (NEW.season, NEW.category, CASE WHEN NEW.status = 'visible' THEN NEW.quantity ELSE 0 END)
    ON CONFLICT (season, category) DO UPDATE SET quantity = quantity + excluded.quantity;
  UPDATE meta SET value = random() & 9007199254740991 WHERE key = 'snapshot_version';
END;

CREATE TRIGGER displays_after_update AFTER UPDATE ON displays
BEGIN
  UPDATE season_totals SET quantity = quantity - CASE WHEN OLD.status = 'visible' THEN OLD.quantity ELSE 0 END
    WHERE season = OLD.season AND category = OLD.category;
  INSERT INTO season_totals (season, category, quantity)
    VALUES (NEW.season, NEW.category, CASE WHEN NEW.status = 'visible' THEN NEW.quantity ELSE 0 END)
    ON CONFLICT (season, category) DO UPDATE SET quantity = quantity + excluded.quantity;
  UPDATE meta SET value = random() & 9007199254740991 WHERE key = 'snapshot_version';
END;

CREATE TRIGGER displays_after_delete AFTER DELETE ON displays
BEGIN
  UPDATE season_totals SET quantity = quantity - CASE WHEN OLD.status = 'visible' THEN OLD.quantity ELSE 0 END
    WHERE season = OLD.season AND category = OLD.category;
  UPDATE meta SET value = random() & 9007199254740991 WHERE key = 'snapshot_version';
END;

UPDATE meta SET value = random() & 9007199254740991 WHERE key = 'snapshot_version';
