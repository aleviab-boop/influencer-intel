-- ============================================================
-- 022: Creator preferences
--
-- A general-purpose per-creator preferences bag (JSONB) for portal settings
-- that don't warrant their own column. First use: monthly earnings goal.
--   { monthly_goal: <int INR>, ... }
-- Shape owned by the feature libs (e.g. lib/earnings-goal.ts).
-- ============================================================

ALTER TABLE creators ADD COLUMN IF NOT EXISTS creator_prefs JSONB;
