-- ============================================================
-- 038: Outreach messages
--
-- A log of the FIRST-CONTACT outreach we send to creators from the discovery /
-- live-search flow — distinct from deal_messages (031), which is the two-way
-- thread on an already-recruited deal. This is the cold/warm opener a brand or
-- the agency fires off before any deal exists, so it is keyed by handle (the one
-- identifier we always have) rather than a program_recruits row.
--
-- Wiring the outreach modal's "Send email" button through a real send + this log
-- turns copy-paste outreach into one-click, tracked delivery. `channel` records
-- how it went out (email today; dm/whatsapp reserved for when those become true
-- one-click sends). `program_id` / `creator_id` are optional back-references,
-- populated when the outreach happens from a known campaign / DB creator.
--
-- `replied_at` is present in the schema but DELIBERATELY UNWIRED for now — reply
-- detection (inbound webhook / mailbox poll) is a later phase. It's here so the
-- response-tracker can light up without another migration once that lands.
-- ============================================================

CREATE TABLE IF NOT EXISTS outreach_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle         TEXT NOT NULL,                 -- the creator's IG handle (always present)
  creator_id     UUID REFERENCES creators(id) ON DELETE SET NULL,
  program_id     UUID REFERENCES programs(id) ON DELETE SET NULL,
  channel        TEXT NOT NULL DEFAULT 'email'
                   CHECK (channel IN ('email', 'dm', 'whatsapp')),
  recipient      TEXT,                          -- email address / phone / handle actually sent to
  subject        TEXT,
  body           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'sent'
                   CHECK (status IN ('sent', 'failed')),
  error          TEXT,
  followup_count INTEGER NOT NULL DEFAULT 0,    -- how many follow-ups after the first send
  replied_at     TIMESTAMPTZ,                   -- reserved: set by future reply detection
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_handle   ON outreach_messages(handle);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_creator  ON outreach_messages(creator_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_program  ON outreach_messages(program_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_status   ON outreach_messages(status, sent_at DESC);
