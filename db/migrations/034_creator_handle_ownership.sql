-- ============================================================
-- 034: Creator handle-ownership verification (bio-code challenge)
--
-- A no-Meta, no-OAuth way to prove a creator actually controls the Instagram
-- handle on their profile: we issue a short one-time code, the creator drops it
-- into their public bio, and we confirm it by re-reading their PUBLIC profile
-- via the existing login-free fetch. No App Review, no Graph API.
--
--   handle_challenge_code — the code we asked them to add to their bio
--   handle_verified_at    — when we last saw the code on their public profile
--
-- This is an ownership signal (identity), distinct from verification_tier
-- (how much we trust their reach data) and is_verified (IG blue-check).
-- ============================================================

ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS handle_challenge_code TEXT,
  ADD COLUMN IF NOT EXISTS handle_verified_at TIMESTAMPTZ;
