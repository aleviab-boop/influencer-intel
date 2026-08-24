-- ============================================================
-- 047: Outreach hand-off status
--
-- When no server-side sender is configured (RESEND_API_KEY unset), the outreach
-- flow hands the drafted email off to the user's own mail app (Gmail compose /
-- mailto) instead of sending it itself. That's a real, tracked contact — the
-- draft goes out from the user's address — but it isn't a confirmed 'sent'
-- (we can't know they hit send) nor a 'failed'. Add a third status, 'handoff',
-- so these appear in the outreach history/response tracker with honest state.
--
-- Idempotent: drops the old inline CHECK by its auto-generated name and re-adds
-- it widened. Safe to re-run.
-- ============================================================

ALTER TABLE outreach_messages DROP CONSTRAINT IF EXISTS outreach_messages_status_check;
ALTER TABLE outreach_messages
  ADD CONSTRAINT outreach_messages_status_check
  CHECK (status IN ('sent', 'failed', 'handoff'));
