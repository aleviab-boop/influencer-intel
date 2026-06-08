-- ============================================================
-- 018_payout_upi.sql
-- Store the creator's UPI ID (VPA) on a payout so the brand can launch a
-- pre-filled UPI payment (Google Pay / PhonePe / Paytm) for that creator.
-- Idempotent.
-- ============================================================
ALTER TABLE program_recruits ADD COLUMN IF NOT EXISTS payout_upi TEXT;
