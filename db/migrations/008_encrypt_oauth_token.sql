-- ============================================================
-- 008_encrypt_oauth_token.sql
--
-- connected_accounts.access_token_encrypted must store the output of
-- boltic_encrypt() — which is bytea — so boltic_decrypt() can read it back.
-- It was TEXT (and tokens were stored in plaintext). Switching to bytea is
-- safe: the table is empty, so no tokens are lost.
--
-- Idempotent — safe to re-run (bytea::bytea is a no-op cast).
-- ============================================================

ALTER TABLE connected_accounts
  ALTER COLUMN access_token_encrypted TYPE bytea
  USING access_token_encrypted::bytea;
