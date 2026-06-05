-- ============================================================
-- 014_creator_applications.sql
-- Creator portal: let creators self-apply to open campaigns by adding an
-- 'applied' status to the recruit pipeline (front of the funnel, before a
-- brand invites/contacts them). Idempotent.
-- ============================================================
ALTER TABLE program_recruits DROP CONSTRAINT IF EXISTS program_recruits_status_check;
ALTER TABLE program_recruits ADD CONSTRAINT program_recruits_status_check
  CHECK (status IN ('applied', 'invited', 'contacted', 'recruited', 'declined'));
