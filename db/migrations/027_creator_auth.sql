-- ============================================================
-- 027_creator_auth.sql
--
-- Lets creators sign in with email + password to CLAIM a profile — no Meta
-- App Review required. Until now a creator identity was only ever minted via
-- Instagram OAuth (the deauthorize/data-deletion path), which is gated behind
-- Advanced Access. Email/password signup lets any scraped creator claim their
-- own row and log into the creator portal today, with unlimited onboarding.
--
-- We reuse the existing `creators` row as the account: `email` + `password_hash`
-- live alongside the scraped profile fields, so claiming just attaches
-- credentials to the profile we already discovered (or inserts a fresh row).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE creators ADD COLUMN IF NOT EXISTS email         text;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS password_hash text;

-- One account per email. Partial so the millions of scraped, credential-less
-- creators (email IS NULL) don't collide on a single NULL — only claimed rows
-- are constrained, and case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS creators_email_unique
  ON creators (lower(email))
  WHERE email IS NOT NULL;
