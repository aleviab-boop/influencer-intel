-- ============================================================
-- 029: Email activity log
--
-- Records every transactional email the platform sends to a creator (invite,
-- payment-received, review verdict, deadline reminder). Powers the agency-side
-- "Email Activity" page so a brand can see exactly what reached each creator
-- and when. Written best-effort from lib/email.ts — a log failure never blocks
-- (or un-sends) an email.
--
-- brand_id/program_id/creator_id are denormalised copies captured at send time
-- and nulled on delete, so the log survives even if the underlying rows go away.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID REFERENCES creators(id) ON DELETE SET NULL,
  program_id  UUID REFERENCES programs(id) ON DELETE SET NULL,
  brand_id    UUID REFERENCES brands(id)   ON DELETE SET NULL,
  kind        TEXT NOT NULL,   -- invite | payment | review_changes | review_approved | deadline
  recipient   TEXT NOT NULL,   -- the email address it was sent to
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL,   -- sent | failed
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_brand   ON email_log(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_program ON email_log(program_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC);
