-- ============================================================
-- 020_saved_creators.sql
--
-- Durable "saved creators" shortlist. Previously kept only in the browser's
-- localStorage, so it was per-device and lost on clear. This persists it in the
-- DB so it survives across devices/sessions and can feed the campaign builder.
--
-- Global (single-agency) for now — add an owner column when multi-user lands.
-- Stores a snapshot so live-discovered creators not yet in `creators` still save.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS saved_creators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle      TEXT NOT NULL,
  creator_id  UUID REFERENCES creators(id) ON DELETE SET NULL,
  snapshot    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (handle)
);

CREATE INDEX IF NOT EXISTS idx_saved_creators_created ON saved_creators(created_at DESC);
