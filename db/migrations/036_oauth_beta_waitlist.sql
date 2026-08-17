-- ============================================================
-- 036: Instagram Connect beta waitlist
--
-- While the Meta app is in development / pending App Review, Instagram Login
-- only works for accounts we've added as testers in the App Dashboard. The
-- allowlist of those handles lives in env (IG_BETA_HANDLES); this table captures
-- everyone ELSE who asks to connect, so when the app goes Live we can invite
-- them back. No PII beyond the handle they typed + an optional contact.
--
--   handle       — the Instagram handle they want to connect (normalised, no @)
--   email        — optional contact to notify when Connect opens up
--   note         — optional free text ("I have 40k followers", etc.)
--   created_at   — first request
--   notified_at  — set once we've emailed them the app is Live (null = pending)
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_beta_waitlist (
  handle       TEXT PRIMARY KEY,
  email        TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oauth_beta_waitlist_pending
  ON oauth_beta_waitlist (created_at)
  WHERE notified_at IS NULL;
