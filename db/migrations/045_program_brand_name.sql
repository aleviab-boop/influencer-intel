-- ============================================================
-- 045_program_brand_name.sql
--
-- Scope campaigns to a brand by NAME, so the brand workspace
-- (/brand/home → "Campaigns you manage") can show ONLY that brand's own
-- programs instead of the shared agency-demo pool (brand_id IS NULL).
--
-- The workspace brand is a localStorage session distilled from /brand-dna
-- and has no authenticated brands(id), so brand_id can't be relied on for
-- scoping there — brand_name gives a stable, auth-independent link.
--
-- Nullable + additive: existing programs (and the agency /campaigns view)
-- are unaffected; only campaigns created from a brand workspace get stamped.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE programs ADD COLUMN IF NOT EXISTS brand_name TEXT;

CREATE INDEX IF NOT EXISTS idx_programs_brand_name ON programs (lower(brand_name));
