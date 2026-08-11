-- ============================================================
-- 025_post_content_scores.sql
--
-- Cache of per-post vision content scores, so the reach model can train on
-- "how good was the actual content" as a feature. Scoring a post costs an
-- OpenAI vision call, so we persist the result once per post and reuse it
-- across retrains. Keyed by (creator_id, post_key) where post_key is the
-- post's platform id (or its URL as a fallback).
--
-- overall  — 0..1 weighted content-quality score (ContentScores.overall_weighted)
-- vision   — true when the model actually saw the image (not caption-only)
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS post_content_scores (
  creator_id  text NOT NULL,
  post_key    text NOT NULL,
  overall     double precision NOT NULL,
  vision      boolean NOT NULL DEFAULT false,
  scored_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_id, post_key)
);

CREATE INDEX IF NOT EXISTS idx_post_content_scores_creator ON post_content_scores(creator_id);
