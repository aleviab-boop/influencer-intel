-- ============================================================
-- 046_deal_signatures.sql
--
-- Real, deliberate e-signatures on the influencer collaboration agreement.
--
-- Until now the contract's signature block was DERIVED from deal lifecycle
-- state (an accepted invite counted as "signed"). That's implicit consent, not
-- a signing action. This table records an EXPLICIT sign-off: a party typed their
-- legal name and affirmed the terms at a point in time.
--
-- `party` is the ROLE, not a user id — a deal has exactly two parties, so
-- 'brand' | 'creator' fully identifies the signer (mirrors deal_messages.sender).
-- One signature per party per deal (UNIQUE), so re-signing is idempotent/upsert.
-- `signer_name` is what they typed; `signed_at` is the audit timestamp.
--
-- Additive + idempotent — existing contracts are unaffected; buildDealContract
-- prefers a real signature when present and falls back to the lifecycle default.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_signatures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruit_id  UUID NOT NULL REFERENCES program_recruits(id) ON DELETE CASCADE,
  party       TEXT NOT NULL CHECK (party IN ('brand', 'creator')),
  signer_name TEXT NOT NULL,
  signed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recruit_id, party)
);

CREATE INDEX IF NOT EXISTS idx_deal_signatures_recruit ON deal_signatures (recruit_id);
