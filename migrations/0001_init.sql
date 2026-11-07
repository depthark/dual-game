-- One row per device. `uid` is a client-generated random UUID and is the only
-- identity in the system: no accounts, no email, no IP stored.
CREATE TABLE IF NOT EXISTS scores (
  uid     TEXT    PRIMARY KEY,
  name    TEXT    NOT NULL,
  score   INTEGER NOT NULL,
  level   INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

-- Backs the "top N" query.
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores (score DESC);
