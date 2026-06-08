-- ============================================================
-- 016_campaign_dates.sql
-- Campaign scheduling: optional start/end dates on a program. Idempotent.
-- ============================================================
ALTER TABLE programs ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS end_date   DATE;
