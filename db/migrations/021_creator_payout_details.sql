-- ============================================================
-- 021: Creator payout details
--
-- Stores HOW a creator gets paid, so the deals/earnings surface has somewhere
-- to point finance. Single JSONB column on creators (not a new table): one
-- payout method per creator, shape owned by lib/creator-payout.ts —
--   { method: 'upi'|'bank', upi_id, account_holder, account_number, ifsc, updated_at }
-- The API only ever returns a masked view (last 4 of account number).
-- ============================================================

ALTER TABLE creators ADD COLUMN IF NOT EXISTS payout_details JSONB;
