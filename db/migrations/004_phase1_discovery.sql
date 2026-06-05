-- ============================================================
-- 004_phase1_discovery.sql
--
-- Phase 1: prompt-driven influencer discovery + storage.
--
-- Split model (matches the existing creators + brief_creators pattern):
--   • creators gains per-influencer discovery facts (genre/niche/region/
--     tags/source/source_url/confidence_score).
--   • discovery_results holds the PER-PROMPT relevance ranking, so the same
--     influencer is stored once and referenced across many prompts.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1) Per-influencer discovery fields on creators
ALTER TABLE creators ADD COLUMN IF NOT EXISTS genre            TEXT;          -- broad: fashion, beauty, travel
ALTER TABLE creators ADD COLUMN IF NOT EXISTS niche            TEXT;          -- fine: resortwear, linen styling
ALTER TABLE creators ADD COLUMN IF NOT EXISTS region           TEXT;          -- Goa / West India (broader than primary_city)
ALTER TABLE creators ADD COLUMN IF NOT EXISTS tags             TEXT[];        -- keywords
ALTER TABLE creators ADD COLUMN IF NOT EXISTS source           TEXT;          -- provenance of the row
ALTER TABLE creators ADD COLUMN IF NOT EXISTS source_url       TEXT;          -- reference link
ALTER TABLE creators ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,2);  -- data-quality confidence 0-100

-- Provenance is constrained to known sources. ICMP is this platform's own
-- creators directory; trends is the trending-creators feed; scrape is the IG
-- harvester; manual is hand-entered.
DO $$ BEGIN
  ALTER TABLE creators ADD CONSTRAINT creators_source_chk
    CHECK (source IS NULL OR source IN ('icmp', 'trends', 'scrape', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_creators_tags   ON creators USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_creators_genre  ON creators(genre);
CREATE INDEX IF NOT EXISTS idx_creators_region ON creators(region);


-- 2) Per-prompt discovery results — relevance is query-dependent, so it lives
--    here (NOT on creators). Mirrors brief_creators.
CREATE TABLE IF NOT EXISTS discovery_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  prompt           TEXT NOT NULL,
  prompt_embedding VECTOR(1536),

  creator_id       UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,

  rank             INTEGER NOT NULL,
  relevance_score  NUMERIC(5,2),   -- how well the creator fits THIS prompt
  confidence_score NUMERIC(5,2),   -- snapshot of data-quality confidence at discovery time
  matched_tags     TEXT[],         -- which prompt keywords matched
  source           TEXT,           -- where this candidate surfaced from

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Re-running the same prompt updates the row instead of duplicating it.
  UNIQUE (prompt, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_discovery_results_prompt  ON discovery_results(prompt, rank);
CREATE INDEX IF NOT EXISTS idx_discovery_results_creator ON discovery_results(creator_id);
