CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'speed')),
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  initials TEXT,
  score INTEGER,
  delivered INTEGER,
  perfects INTEGER,
  longest INTEGER,
  litter INTEGER,
  finished_at INTEGER
);

CREATE INDEX leaderboard ON runs (mode, score DESC, finished_at, id) WHERE score IS NOT NULL;

CREATE TABLE play_counts (
  mode TEXT PRIMARY KEY,
  plays INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER count_play AFTER INSERT ON runs
BEGIN
  INSERT INTO play_counts (mode, plays) VALUES (NEW.mode, 1)
    ON CONFLICT (mode) DO UPDATE SET plays = plays + 1;
END;
