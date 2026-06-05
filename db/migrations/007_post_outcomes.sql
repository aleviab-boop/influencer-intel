-- ============================================================
-- 007_post_outcomes.sql
--
-- Phase 3: predicted-vs-real tracking. Each row pairs a prediction snapshot
-- (taken before a post) with the actual results (entered after it goes live).
-- This powers the predicted-vs-real chart WITHOUT IG Graph OAuth — actuals are
-- recorded manually now; auto-fetch via connected_accounts is a later upgrade.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS post_outcomes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  program_id       UUID REFERENCES programs(id) ON DELETE SET NULL,

  post_url         TEXT,
  posted_at        TIMESTAMPTZ,

  -- prediction snapshot (at planning time)
  predicted_er     NUMERIC(7,5),
  predicted_likes  INTEGER,
  predicted_views  INTEGER,

  -- actual results (recorded after the post is live)
  actual_likes     INTEGER,
  actual_comments  INTEGER,
  actual_views     INTEGER,
  actual_er        NUMERIC(7,5),

  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_outcomes_creator ON post_outcomes(creator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_post_outcomes_program ON post_outcomes(program_id);
