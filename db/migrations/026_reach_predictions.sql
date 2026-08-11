-- ============================================================
-- 026_reach_predictions.sql
--
-- A ledger of every reach forecast we make. Until now forecasts were
-- ephemeral — computed on demand and thrown away — so an outcome recorded
-- later had to carry a hand-copied snapshot of the prediction (the source of
-- the earlier predicted_er unit-mismatch bug). Persisting each forecast lets us:
--   • link a recorded actual straight back to the forecast it's scoring
--   • show a forecast history and which ones have been scored
--   • audit drift over time without re-deriving old predictions
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS reach_predictions (
  id                 text PRIMARY KEY,
  creator_id         text NOT NULL,
  format             text,
  predicted_likes    integer,
  predicted_views    integer,            -- null for non-video formats
  predicted_comments integer,
  predicted_er       double precision,
  bucket             text,
  confidence         text,
  baseline_likes     integer,
  baseline_views     integer,
  model_trained_at   timestamptz,        -- which trained model produced it (if any)
  caption_preview    text,               -- first ~140 chars, for context
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reach_predictions_creator ON reach_predictions(creator_id);
CREATE INDEX IF NOT EXISTS idx_reach_predictions_created ON reach_predictions(created_at DESC);

-- Link a recorded outcome back to the forecast it scores.
ALTER TABLE post_outcomes ADD COLUMN IF NOT EXISTS prediction_id text;
CREATE INDEX IF NOT EXISTS idx_post_outcomes_prediction ON post_outcomes(prediction_id);
