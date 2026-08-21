-- 044_visual_trends.sql
-- Visual / aesthetic trend detection.
--
-- Adds a 'visual' trend_type so we can track image-only trends that carry no
-- hashtag (e.g. "stripes", "pastel palette", "y2k styling") — derived by running
-- post thumbnails through a vision model. post_visual_tags caches each post's
-- extracted motifs so the ingest never pays to re-tag the same image.
-- Idempotent: safe to re-run.

-- 1. Allow trend_type = 'visual'. The inline CHECK from 001 is named
--    trend_signals_trend_type_check by Postgres; drop & re-add it.
ALTER TABLE trend_signals DROP CONSTRAINT IF EXISTS trend_signals_trend_type_check;
ALTER TABLE trend_signals
  ADD CONSTRAINT trend_signals_trend_type_check
  CHECK (trend_type IN ('audio', 'format', 'hashtag', 'topic', 'visual'));

-- 2. Per-post cache of extracted visual motifs. Keyed by the Instagram post id so
--    a post is only ever vision-tagged once. An empty tags array is cached too,
--    so unreadable/expired thumbnails aren't retried every run.
CREATE TABLE IF NOT EXISTS post_visual_tags (
  platform_post_id  TEXT PRIMARY KEY,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  tagged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
