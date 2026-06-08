-- ============================================================
-- 017_payout_methods.sql
-- Payout methods (how a brand pays creators): UPI / bank / PayPal / other.
-- The brand can add or remove these on the Payouts page. Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS payout_methods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID REFERENCES brands(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'upi' CHECK (type IN ('upi', 'bank', 'paypal', 'other')),
  detail      TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payout_methods_created ON payout_methods(created_at);
