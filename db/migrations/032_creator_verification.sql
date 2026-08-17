-- ============================================================
-- 032: Creator verification tier
--
-- Lets creators self-onboard and earn a trust signal WITHOUT the Meta App
-- Review gate. `is_verified` already exists but means "Instagram blue-check"
-- (scraped from IG) — a different thing. This column records how much WE trust
-- the creator's own reach data, on a ladder:
--
--   oauth         — connected their IG via OAuth; live Graph API metrics (needs
--                   App Review for the public, but kept as the top rung)
--   screenshot    — uploaded an Insights screenshot as proof
--   public        — we auto-filled from their PUBLIC profile (login-free fetch)
--   self_reported — they typed their numbers in; unverified
--   NULL          — nothing on file yet
--
-- Deliberately no FK to any Meta concept: the whole point is that the common
-- path (public / self_reported) never touches Meta.
-- ============================================================

ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS verification_tier TEXT
    CHECK (verification_tier IN ('oauth', 'screenshot', 'public', 'self_reported')),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
