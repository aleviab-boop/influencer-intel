-- ============================================================
-- 037: Third-party creator connectors (Phyllo / InsightIQ, …)
--
-- A creator-data AGGREGATOR (Phyllo, now InsightIQ) handles the platform OAuth
-- with its OWN reviewed app and hands us normalised profile + audience + content
-- data over an API. That means a creator can connect real Instagram metrics
-- through us WITHOUT us needing our own Meta App Review — the aggregator carries
-- the review. This table records that linkage, provider-agnostic so a second
-- aggregator can slot in later.
--
--   provider          — 'phyllo' (extensible)
--   provider_user_id  — the aggregator's user id we created for this creator
--   provider_account_id — the connected platform account id (per work platform)
--   work_platform     — 'instagram' | 'youtube' | …
--   username          — the connected handle as the aggregator reports it
--   status            — 'pending' (SDK opened) | 'connected' | 'disconnected' | 'error'
--   raw               — last provider payload (profile/audience), for debugging
-- ============================================================

CREATE TABLE IF NOT EXISTS creator_connectors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id          UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'phyllo',
  provider_user_id    TEXT,
  provider_account_id TEXT,
  work_platform       TEXT,
  username            TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'connected', 'disconnected', 'error')),
  raw                 JSONB,
  connected_at        TIMESTAMPTZ,
  last_sync_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per creator+provider+platform; a re-connect updates in place.
  UNIQUE (provider, provider_user_id, work_platform)
);

CREATE INDEX IF NOT EXISTS idx_creator_connectors_creator ON creator_connectors(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_connectors_account ON creator_connectors(provider_account_id);
CREATE INDEX IF NOT EXISTS idx_creator_connectors_status  ON creator_connectors(status);
