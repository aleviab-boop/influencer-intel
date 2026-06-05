-- ============================================================
-- 010_automations.sql
--
-- Comment-to-DM automation (Phase 1 — simulated runner). An automation
-- watches a post for a keyword comment and (when wired to the real IG
-- Messaging API in Phase 2) sends an auto-DM. `automation_runs` logs each
-- triggered/simulated event for the dashboard + audit.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS automations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id  UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,

  name                  TEXT NOT NULL,
  post_label            TEXT,                                   -- which post (free text until real IG media)
  trigger_type          TEXT NOT NULL DEFAULT 'keyword' CHECK (trigger_type IN ('keyword', 'any')),
  keyword               TEXT,
  dm_message            TEXT NOT NULL,
  comment_reply         TEXT,                                   -- optional public reply

  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'draft')),
  reply_count           INTEGER NOT NULL DEFAULT 0,
  last_active_at        TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  commenter     TEXT,
  comment_text  TEXT,
  matched       BOOLEAN NOT NULL DEFAULT FALSE,
  dm_sent       TEXT,
  status        TEXT NOT NULL DEFAULT 'simulated' CHECK (status IN ('simulated', 'sent', 'skipped', 'failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, created_at DESC);
