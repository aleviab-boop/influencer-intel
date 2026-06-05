-- ============================================================
-- 013_creative_assets.sql
-- Media Management: a creative library with an approval workflow.
-- Assets optionally belong to a campaign (program) and a creator.
-- Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS creative_assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id     UUID REFERENCES programs(id) ON DELETE SET NULL,
  creator_handle TEXT,
  title          TEXT NOT NULL,
  asset_type     TEXT NOT NULL DEFAULT 'reel' CHECK (asset_type IN ('reel','image','carousel','story')),
  asset_url      TEXT,
  caption        TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','changes')),
  version        INTEGER NOT NULL DEFAULT 1,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_creative_assets_program ON creative_assets(program_id);
