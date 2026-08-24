-- ============================================================
-- 048: Per-post topic tag cache
--
-- 'topic' is already an allowed trend_type (see 044), but nothing populated it —
-- hashtags/formats are pure frequency counts and visual motifs come from images.
-- Topics are the *subject* of a post ("grwm", "budget travel", "street food",
-- "gym transformation"), which lives in the caption text. We extract 1-3 topic
-- tags per post with a cheap batched LLM pass and aggregate them exactly like
-- hashtags so a genuine "what's viral right now" board can surface.
--
-- This table caches each post's extracted topics keyed by the Instagram post id,
-- so the ingest never pays to re-tag the same caption. An empty tags array is
-- cached too, so captionless / untaggable posts aren't retried every run.
-- Mirrors post_visual_tags (044). Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS post_topic_tags (
  platform_post_id  TEXT PRIMARY KEY,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  tagged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
