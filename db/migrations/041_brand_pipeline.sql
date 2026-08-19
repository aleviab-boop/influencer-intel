-- ============================================================
-- 041: Brand pipeline
--
-- A per-brand creator pipeline OWNED by an agency account — the bridge that turns
-- one-off discovery (campaign shortlists, scoped search) into a persistent, owned
-- funnel. An agency saves creators against one of their brands and moves them
-- through outreach stages (saved → contacted → replied → negotiating → won/passed).
--
-- Scoped to (account_id, brand_name) so it lines up with brand_dna ownership
-- (migration 040): "my pipeline for GlowRoot" is distinct from "my pipeline for
-- another brand", and neither leaks across agencies. `snapshot` holds a LiveProfile
-- JSON so a creator surfaced live (not yet in the creators table) still persists.
-- Requiring an account to save is intentional: it makes the pipeline a reason to
-- create an account, and the sourced-creator history a real switching cost.
-- ============================================================

CREATE TABLE IF NOT EXISTS brand_pipeline (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES agency_accounts(id) ON DELETE CASCADE,
  brand_name  TEXT NOT NULL,
  handle      TEXT NOT NULL,                       -- creator IG handle (always present)
  creator_id  UUID REFERENCES creators(id) ON DELETE SET NULL,
  snapshot    JSONB,                               -- LiveProfile snapshot (name, followers, ER, pic)
  status      TEXT NOT NULL DEFAULT 'saved'
                CHECK (status IN ('saved','contacted','replied','negotiating','won','passed')),
  note        TEXT,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per creator per brand per account (re-saving updates, never duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_pipeline_unique
  ON brand_pipeline(account_id, lower(brand_name), lower(handle));

-- The list view: this account's pipeline for a brand, by stage / recency.
CREATE INDEX IF NOT EXISTS idx_brand_pipeline_lookup
  ON brand_pipeline(account_id, lower(brand_name), status, added_at DESC);
