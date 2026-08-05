-- Follower snapshot history — powers the growth-over-time chart on the
-- creator "My Analytics" dashboard. Instagram's Graph API only exposes the
-- CURRENT follower count (no history), so we record one row per connected
-- account per day. The analytics endpoint upserts today's snapshot on each
-- load; the curve fills in as the account is viewed over time.

CREATE TABLE IF NOT EXISTS follower_snapshots (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id     UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  creator_id               UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  followers_count          INTEGER,
  follows_count            INTEGER,
  media_count              INTEGER,
  captured_on              DATE NOT NULL DEFAULT CURRENT_DATE,
  captured_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connected_account_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_follower_snapshots_account
  ON follower_snapshots(connected_account_id, captured_on DESC);
