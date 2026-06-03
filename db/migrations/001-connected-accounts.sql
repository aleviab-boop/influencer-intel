-- Connected Accounts + Post Insights + Trend Signals for Content Growth Engine

CREATE TABLE IF NOT EXISTS connected_accounts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id               UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  brand_id                 UUID REFERENCES brands(id) ON DELETE SET NULL,
  ig_user_id               TEXT NOT NULL,
  ig_username              TEXT NOT NULL,
  access_token_encrypted   TEXT NOT NULL,
  token_expires_at         TIMESTAMPTZ,
  scopes                   TEXT[] NOT NULL DEFAULT '{}',
  connection_status        TEXT NOT NULL DEFAULT 'active'
                           CHECK (connection_status IN ('active', 'expired', 'revoked', 'error')),
  last_sync_at             TIMESTAMPTZ,
  last_sync_status         TEXT DEFAULT 'pending'
                           CHECK (last_sync_status IN ('pending', 'syncing', 'completed', 'failed')),
  sync_error               TEXT,
  posts_synced_count       INTEGER NOT NULL DEFAULT 0,
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ig_user_id)
);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_creator ON connected_accounts(creator_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_status  ON connected_accounts(connection_status);

CREATE TABLE IF NOT EXISTS post_insights (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id     UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  creator_id               UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  ig_media_id              TEXT NOT NULL,
  ig_shortcode             TEXT NOT NULL,
  media_type               TEXT NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM', 'REELS')),
  media_url                TEXT,
  thumbnail_url            TEXT,
  caption                  TEXT,
  permalink                TEXT NOT NULL,
  posted_at                TIMESTAMPTZ NOT NULL,
  like_count               INTEGER NOT NULL DEFAULT 0,
  comment_count            INTEGER NOT NULL DEFAULT 0,
  reach                    INTEGER,
  impressions              INTEGER,
  saved                    INTEGER,
  shares                   INTEGER,
  plays                    INTEGER,
  total_interactions       INTEGER,
  engagement_rate          NUMERIC(7,6),
  performance_bucket       TEXT CHECK (performance_bucket IN ('breakout', 'above_average', 'average', 'below_average')),
  content_scores           JSONB,
  content_scored_at        TIMESTAMPTZ,
  fetched_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  insights_fetched_at      TIMESTAMPTZ,
  UNIQUE (connected_account_id, ig_media_id)
);

CREATE INDEX IF NOT EXISTS idx_post_insights_creator   ON post_insights(creator_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_insights_account   ON post_insights(connected_account_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_insights_shortcode ON post_insights(ig_shortcode);
CREATE INDEX IF NOT EXISTS idx_post_insights_bucket    ON post_insights(performance_bucket) WHERE performance_bucket IS NOT NULL;

CREATE TABLE IF NOT EXISTS trend_signals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trend_type               TEXT NOT NULL CHECK (trend_type IN ('audio', 'format', 'hashtag', 'topic')),
  identifier               TEXT NOT NULL,
  display_name             TEXT NOT NULL,
  phase                    TEXT NOT NULL DEFAULT 'emerging'
                           CHECK (phase IN ('emerging', 'growing', 'peak', 'saturated', 'declining')),
  velocity                 NUMERIC(8,4) NOT NULL DEFAULT 0,
  first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  peak_at                  TIMESTAMPTZ,
  usage_count_24h          INTEGER NOT NULL DEFAULT 0,
  usage_count_7d           INTEGER NOT NULL DEFAULT 0,
  avg_er_boost             NUMERIC(5,4),
  categories               TEXT[] NOT NULL DEFAULT '{}',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trend_type, identifier)
);

CREATE INDEX IF NOT EXISTS idx_trend_signals_phase ON trend_signals(phase, velocity DESC);

CREATE TABLE IF NOT EXISTS monitored_posts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id     UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  creator_id               UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  post_insight_id          UUID REFERENCES post_insights(id) ON DELETE SET NULL,
  ig_media_id              TEXT NOT NULL,
  permalink                TEXT NOT NULL,
  monitoring_status        TEXT NOT NULL DEFAULT 'active'
                           CHECK (monitoring_status IN ('active', 'paused', 'completed')),
  checkpoints_completed    TEXT[] NOT NULL DEFAULT '{}',
  next_checkpoint_at       TIMESTAMPTZ,
  predictions              JSONB NOT NULL DEFAULT '[]',
  started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ,
  UNIQUE (ig_media_id)
);

CREATE INDEX IF NOT EXISTS idx_monitored_posts_next ON monitored_posts(next_checkpoint_at)
  WHERE monitoring_status = 'active';
