-- ============================================================
-- 024_post_outcomes_format.sql
--
-- Record the post FORMAT (reel / photo / carousel) alongside each outcome, so
-- the reach predictor can self-calibrate per format — reels and photos carry
-- different systematic bias — instead of one global correction.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE post_outcomes ADD COLUMN IF NOT EXISTS format TEXT;

CREATE INDEX IF NOT EXISTS idx_post_outcomes_format ON post_outcomes(format);
