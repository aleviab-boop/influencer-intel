-- ============================================================
-- 042: Scope outreach to the sending agency account
--
-- outreach_messages (038) is keyed by handle only — fine when the sole consumer
-- was the discovery flow. But the brand pipeline (041) is OWNED by an agency
-- account, and we now want to show each creator's outreach HISTORY inside their
-- pipeline row. Fetching that by handle alone would leak one agency's outreach
-- (recipient email + full body) to any other agency that also saved the creator.
--
-- So stamp the sending account on each row. Nullable + ON DELETE SET NULL: the
-- discovery flow (no agency session) still logs sends with a NULL account_id,
-- and history queries scope to `account_id = <me>` so nothing crosses agencies.
-- ============================================================

ALTER TABLE outreach_messages
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES agency_accounts(id) ON DELETE SET NULL;

-- The history lookup: this account's sends to a given creator, newest first.
CREATE INDEX IF NOT EXISTS idx_outreach_messages_account
  ON outreach_messages(account_id, lower(handle), sent_at DESC);
