-- ============================================================
-- 006_quality_scores.sql
--
-- Phase 2: absolute influencer QUALITY score (0-100) computed from
-- followers + engagement + per-post likes/comments. Drives the
-- "drop below 80" gate. Distinct from per-prompt relevance.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE creators ADD COLUMN IF NOT EXISTS quality_score     NUMERIC(5,2);
ALTER TABLE creators ADD COLUMN IF NOT EXISTS quality_breakdown JSONB;     -- { engagement, comment_quality, consistency, authenticity }
ALTER TABLE creators ADD COLUMN IF NOT EXISTS quality_band      TEXT
  CHECK (quality_band IS NULL OR quality_band IN ('pass', 'weak', 'insufficient_data'));
ALTER TABLE creators ADD COLUMN IF NOT EXISTS quality_scored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_creators_quality ON creators(quality_score);

-- Snapshot the quality score onto each discovery result too, so a stored
-- shortlist reflects the score at discovery time.
ALTER TABLE discovery_results ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2);
