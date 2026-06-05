-- ============================================================
-- 009_campaign_budget.sql
--
-- Campaign Management depth: a budget per campaign, plus deliverables,
-- a due date and an agreed rate per recruited creator. Spend is derived
-- from the sum of rates of non-declined recruits.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE programs         ADD COLUMN IF NOT EXISTS budget       NUMERIC(12,2);

ALTER TABLE program_recruits ADD COLUMN IF NOT EXISTS deliverables TEXT;
ALTER TABLE program_recruits ADD COLUMN IF NOT EXISTS due_date     DATE;
ALTER TABLE program_recruits ADD COLUMN IF NOT EXISTS rate         NUMERIC(12,2);
