-- ============================================================
-- 023: Deliverable submissions
--
-- Per-deal proof-of-work: the live post URLs a creator attaches once they've
-- published each deliverable, so a deal can actually be closed out (and, later,
-- so a brand can verify). Stored as a JSONB array on the recruit row:
--   [ { id, label, url, platform, note, created_at }, ... ]
-- Shape owned by lib/deliverable-submission.ts. No new table — submissions are
-- 1:1 with the deal and never queried independently.
-- ============================================================

ALTER TABLE program_recruits ADD COLUMN IF NOT EXISTS submissions JSONB;
