-- Nicknames are unique on the board (names are stored upper-cased, so this is
-- effectively case-insensitive). Backs the rename check and stops two devices
-- racing to the same name.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_name ON scores (name);
