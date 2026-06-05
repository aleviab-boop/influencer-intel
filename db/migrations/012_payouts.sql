-- ============================================================
-- 012_payouts.sql
-- Influencer Payouts: track whether a recruited creator has been paid.
-- Spend/commitment comes from program_recruits.rate (migration 009).
-- Idempotent.
-- ============================================================
ALTER TABLE program_recruits ADD COLUMN IF NOT EXISTS paid    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE program_recruits ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
