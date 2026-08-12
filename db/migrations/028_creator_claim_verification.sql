-- ============================================================
-- 028_creator_claim_verification.sql
--
-- Proof-of-ownership for email-claimed creator profiles. Email/password signup
-- (migration 027) lets anyone CLAIM a handle without proving they own it — an
-- impersonation risk. This adds a lightweight, scrape-verifiable check:
--   • claim_code: a short token we ask the creator to put in their IG bio
--   • claim_verified: flips true once a scrape confirms the code is in the bio
-- Verification is optional and non-blocking (a badge, not a gate) for now, so it
-- doesn't add friction to onboarding — but it lets us distinguish a proven owner
-- from an unverified claim, and gate sensitive actions (e.g. payouts) later.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE creators ADD COLUMN IF NOT EXISTS claim_code     text;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS claim_verified boolean DEFAULT false;
