-- ============================================================
-- Influencer Intel — Boltic Tables schema (v0, 6 tables)
-- ============================================================
-- 1:1 per-creator data is folded into JSONB columns on `creators`
-- (audience_demographics, credibility, recent_posts, verified_oauth_data).
-- Junction `brief_creators` carries the shortlist + outreach + outcome.
-- Standard PostgreSQL syntax; adapt to Boltic Tables's specific DDL where needed.
-- ============================================================


-- ============================================================
-- 1. CREATORS
-- ============================================================

CREATE TABLE creators (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Platform identity
  platform                 TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube')),
  handle                   TEXT NOT NULL,
  profile_url              TEXT NOT NULL,

  -- Display
  display_name             TEXT,
  bio                      TEXT,
  profile_photo_url        TEXT,
  is_verified              BOOLEAN DEFAULT FALSE,

  -- Categorisation
  primary_category         TEXT,
  content_languages        TEXT[],
  primary_city             TEXT,
  city_tier                TEXT CHECK (city_tier IN ('tier_1', 'tier_2', 'tier_3', 'unknown')),
  data_tier                TEXT NOT NULL DEFAULT 'tier_c' CHECK (data_tier IN ('tier_a', 'tier_b', 'tier_c')),

  -- Reach
  follower_count           INTEGER,
  following_count          INTEGER,
  posts_count              INTEGER,

  -- Engagement
  avg_views                INTEGER,
  avg_likes                INTEGER,
  avg_comments             INTEGER,
  engagement_rate          NUMERIC(5,4),

  -- Quality flags
  is_active                BOOLEAN DEFAULT TRUE,
  is_indian                BOOLEAN,
  is_verified_creator      BOOLEAN DEFAULT FALSE,

  -- Folded JSONB columns (1:1 with creator)
  -- recent_posts: array of { platform_post_id, post_url, post_type, caption, posted_at, view_count, like_count, comment_count }
  recent_posts             JSONB,
  -- audience_demographics: { source, sample_size, confidence, gender:{male,female,other_pct}, age_bands:{18_24,25_34,35_44,45_64}, top_cities:[{city,pct}], country_india_pct, top_languages:[{lang,pct}], computed_at }
  audience_demographics    JSONB,
  -- credibility: { overall_score, badge, signals:{...10 keys...}, flags:[], computed_at }
  credibility              JSONB,
  -- verified_oauth_data: { email, oauth_provider, access_token_encrypted, refresh_token_encrypted, expires_at, insights, insights_fetched_at, subscription_tier }
  verified_oauth_data      JSONB,

  -- Embedding for brief-to-shortlist match
  content_embedding        VECTOR(1536),

  -- Timestamps
  first_indexed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_scraped_at          TIMESTAMPTZ,
  last_full_refresh        TIMESTAMPTZ,

  UNIQUE (platform, handle)
);

CREATE INDEX idx_creators_data_tier      ON creators(data_tier);
CREATE INDEX idx_creators_category       ON creators(primary_category);
CREATE INDEX idx_creators_languages      ON creators USING GIN(content_languages);
CREATE INDEX idx_creators_city           ON creators(primary_city, city_tier);
CREATE INDEX idx_creators_followers      ON creators(follower_count);
CREATE INDEX idx_creators_embedding      ON creators USING hnsw(content_embedding vector_cosine_ops);


-- ============================================================
-- 2. BRANDS
-- ============================================================

CREATE TABLE brands (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  category              TEXT,

  voice_samples         JSONB,           -- [{ "type": "post", "text": "..." }]
  users                 JSONB,           -- [{ "id", "email", "name", "role", "gmail_oauth_token_encrypted", "ig_oauth_token_encrypted", "last_login_at" }]

  plan                  TEXT CHECK (plan IN ('design_partner', 'growth', 'scale')),
  research_quota_used   INTEGER NOT NULL DEFAULT 0,
  research_quota_max    INTEGER NOT NULL DEFAULT 50,
  onboarded_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 3. BRIEFS
-- ============================================================

CREATE TABLE briefs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id              UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  raw_text              TEXT NOT NULL,

  -- parsed_spec: { campaign_type, category, target_gender, target_age_min, target_age_max, target_cities:[], target_languages:[], budget_amount, vibe, reference_creators:[], excluded_creators:[] }
  parsed_spec           JSONB,

  brief_embedding       VECTOR(1536),

  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'parsed', 'shortlisted', 'archived')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parsed_at             TIMESTAMPTZ
);

CREATE INDEX idx_briefs_brand            ON briefs(brand_id);
CREATE INDEX idx_briefs_embedding        ON briefs USING hnsw(brief_embedding vector_cosine_ops);


-- ============================================================
-- 4. BRIEF_CREATORS — the shortlist
-- ============================================================

CREATE TABLE brief_creators (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id              UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  brand_id              UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  creator_id            UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,

  rank                  INTEGER NOT NULL,
  match_score           NUMERIC(5,2),
  reasoning             TEXT,
  freshness             TEXT,           -- 'just_scraped' | 'fresh' | 'stale' | 'refreshing'

  -- outreach: { channel, draft_text, edited_text, status, sent_at, replied_at, reply_text, reply_classification }
  outreach              JSONB,
  -- outcome: { post_url, reach, likes, comments, saves, shares, predicted_engagement_rate, actual_engagement_rate, brand_rating, brand_notes, fetched_at }
  outcome               JSONB,

  brand_action          TEXT CHECK (brand_action IN ('selected', 'dropped', 'pending')),
  brand_action_at       TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brief_id, creator_id)
);

CREATE INDEX idx_brief_creators_brief    ON brief_creators(brief_id, rank);
CREATE INDEX idx_brief_creators_creator  ON brief_creators(creator_id);


-- ============================================================
-- 5. SCRAPE_JOBS — queue
-- ============================================================

CREATE TABLE scrape_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  job_type              TEXT NOT NULL CHECK (job_type IN (
                          'on_demand', 'refresh', 'audience_inference',
                          'discovery_crawl', 'comment_sample', 'credibility_recompute'
                        )),
  target_platform       TEXT,
  target_handle         TEXT NOT NULL,
  creator_id            UUID REFERENCES creators(id) ON DELETE CASCADE,
  brief_id              UUID REFERENCES briefs(id) ON DELETE CASCADE,

  priority              INTEGER NOT NULL DEFAULT 5,

  status                TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'in_progress', 'completed', 'failed', 'skipped')),
  attempts              INTEGER NOT NULL DEFAULT 0,

  assigned_account_id   UUID,
  result_summary        JSONB,
  error_message         TEXT,

  requested_by_brand    UUID REFERENCES brands(id),

  queued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ
);

CREATE INDEX idx_scrape_jobs_status_pri  ON scrape_jobs(status, priority);
CREATE INDEX idx_scrape_jobs_queued      ON scrape_jobs(queued_at) WHERE status = 'queued';


-- ============================================================
-- 6. SERVICE_ACCOUNTS — IG/YT scraping accounts (login state)
-- ============================================================

CREATE TABLE service_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  platform              TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube')),
  handle                TEXT NOT NULL,
  email                 TEXT,
  phone_number          TEXT,

  -- Captured via Playwright storageState() in the admin frontend
  storage_state         JSONB,
  storage_captured_at   TIMESTAMPTZ,
  storage_expires_at    TIMESTAMPTZ,

  status                TEXT NOT NULL DEFAULT 'warming' CHECK (status IN ('warming', 'active', 'flagged', 'banned', 'retired')),
  proxy_assignment      TEXT,
  device_fingerprint    JSONB,
  daily_action_count    INTEGER NOT NULL DEFAULT 0,
  total_scrapes         INTEGER NOT NULL DEFAULT 0,

  category_focus        TEXT,
  geo_focus             TEXT,

  warmed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (platform, handle)
);

CREATE INDEX idx_service_accounts_status ON service_accounts(status);


-- ============================================================
-- Notes
-- ============================================================
-- Encrypt at rest (column or app-layer):
--   - brands.users (contains gmail_oauth_token_encrypted, ig_oauth_token_encrypted)
--   - service_accounts.storage_state
--   - creators.verified_oauth_data
--
-- JSONB shapes are documented inline above. Application code in
-- shared/types/index.ts mirrors them as TypeScript types.
--
-- Stage 2+ additions (deferred):
--   - creator_comments table (when comment-text classifier ships)
--   - separate brand_users table (when real auth + invites are needed)
--   - shortlist_versions or audit log if brief re-runs require history
