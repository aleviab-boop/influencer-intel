-- ============================================================
-- 039: Brand DNA
--
-- A saved "Brand DNA" profile — the AI's structured read of a brand (positioning,
-- values, tone, audience, aesthetic, content pillars, fitting creator archetypes)
-- built from its website + socials. This is the front of the brand flow:
-- Brand DNA → campaign suggestions → creator shortlist → outreach, so persisting
-- it lets the campaign-ideas step reuse the analysis instead of re-deriving it.
--
-- Append-only history keyed by brand name: each analysis inserts a new row, and
-- readers take the most recent one (ORDER BY created_at DESC). `profile` holds the
-- full BrandDnaProfile JSON so the shape can evolve without a migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS brand_dna (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name  TEXT NOT NULL,
  url         TEXT,
  social      TEXT,
  profile     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest-per-brand lookups hit this (lower() for case-insensitive brand match).
CREATE INDEX IF NOT EXISTS idx_brand_dna_name ON brand_dna(lower(brand_name), created_at DESC);
