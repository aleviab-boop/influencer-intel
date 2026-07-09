-- ============================================================
-- 019_service_account_last_used.sql
--
-- Track which service account the worker last crawled with, so the admin
-- Scraper page can show a live "active now" badge on the account currently
-- in rotation (the orchestrator stamps this on every job pick).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE service_accounts ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
