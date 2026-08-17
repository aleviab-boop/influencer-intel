-- ============================================================
-- 031: Deal messages
--
-- A per-deal message thread between a brand and a creator, scoped to one
-- program_recruits row (the deal both sides already share via the deal
-- workspace / campaign review). Gives the two parties a place to talk about a
-- specific collaboration instead of leaving it to off-platform DMs.
--
-- `sender` is the ROLE, not a user id — there are exactly two parties per deal,
-- so 'brand' | 'creator' fully identifies who spoke. `read_at` is set when the
-- OTHER party opens the thread, which is enough to drive unread counts (a
-- message is unread iff sender = counterpart AND read_at IS NULL).
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruit_id  UUID NOT NULL REFERENCES program_recruits(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL CHECK (sender IN ('brand', 'creator')),
  body        TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_messages_recruit ON deal_messages(recruit_id, created_at);
