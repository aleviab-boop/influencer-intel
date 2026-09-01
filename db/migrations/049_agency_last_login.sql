-- ============================================================
-- 049: Track last sign-in on agency (and brand) accounts
--
-- agency_accounts (040) records created_at/updated_at but nothing about when an
-- account was last USED. The admin Metrics logins/DAU feed reconstructs activity
-- from activity_events, but that's an append-only log — there's no cheap "when did
-- this account last log in" on the account row itself. Add last_login_at, stamped
-- by signInAgency on every successful password sign-in (see lib/agency-auth.ts),
-- so the roster / admin views can sort and surface dormant vs. active accounts
-- without scanning the event log.
--
-- Nullable: existing rows have never been stamped, and a NULL reads as "not since
-- we started tracking". Backfilled to created_at so old accounts sort sensibly.
-- ============================================================

ALTER TABLE agency_accounts
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

UPDATE agency_accounts
   SET last_login_at = created_at
 WHERE last_login_at IS NULL;
