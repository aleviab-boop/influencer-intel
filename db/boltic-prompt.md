# Boltic schema prompts — 6 tables

Paste each prompt separately into Boltic's AI / table builder. Each one creates a single table.

---

**1. creators**

Create table `creators` with columns: `id` (UUID PK default gen_random_uuid()), `platform` (text), `handle` (text), `profile_url` (text), `display_name` (text), `bio` (text), `profile_photo_url` (text), `is_verified` (bool default false), `follower_count` (int), `following_count` (int), `posts_count` (int), `avg_views` (int), `avg_likes` (int), `avg_comments` (int), `engagement_rate` (numeric(5,4)), `primary_category` (text), `content_languages` (text[]), `primary_city` (text), `city_tier` (text), `data_tier` (text default 'tier_c'), `is_active` (bool default true), `is_indian` (bool), `is_verified_creator` (bool default false), `recent_posts` (jsonb), `audience_demographics` (jsonb), `credibility` (jsonb), `verified_oauth_data` (jsonb), `content_embedding` vector(1536), `first_indexed_at` (timestamptz default now()), `last_scraped_at` (timestamptz), `last_full_refresh` (timestamptz). UNIQUE on (platform, handle). HNSW index on content_embedding using vector_cosine_ops.

---

**2. brands**

Create table `brands` with columns: `id` (UUID PK default gen_random_uuid()), `name` (text), `slug` (text UNIQUE), `category` (text), `voice_samples` (jsonb), `users` (jsonb), `plan` (text), `research_quota_used` (int default 0), `research_quota_max` (int default 50), `onboarded_at` (timestamptz), `created_at` (timestamptz default now()), `updated_at` (timestamptz default now()).

---

**3. briefs**

Create table `briefs` with columns: `id` (UUID PK default gen_random_uuid()), `brand_id` (uuid references brands(id) on delete cascade), `raw_text` (text not null), `parsed_spec` (jsonb), `brief_embedding` vector(1536), `status` (text default 'pending'), `created_at` (timestamptz default now()), `parsed_at` (timestamptz). Index on brand_id. HNSW index on brief_embedding using vector_cosine_ops.

---

**4. brief_creators**

Create table `brief_creators` with columns: `id` (UUID PK default gen_random_uuid()), `brief_id` (uuid references briefs(id) on delete cascade), `brand_id` (uuid references brands(id) on delete cascade), `creator_id` (uuid references creators(id) on delete cascade), `rank` (int not null), `match_score` (numeric(5,2)), `reasoning` (text), `freshness` (text), `outreach` (jsonb), `outcome` (jsonb), `brand_action` (text), `brand_action_at` (timestamptz), `created_at` (timestamptz default now()). UNIQUE on (brief_id, creator_id). Index on (brief_id, rank).

---

**5. scrape_jobs**

Create table `scrape_jobs` with columns: `id` (UUID PK default gen_random_uuid()), `job_type` (text not null), `target_platform` (text), `target_handle` (text not null), `creator_id` (uuid references creators(id) on delete cascade), `brief_id` (uuid references briefs(id) on delete cascade), `priority` (int default 5), `status` (text default 'queued'), `attempts` (int default 0), `assigned_account_id` (uuid), `result_summary` (jsonb), `error_message` (text), `requested_by_brand` (uuid references brands(id)), `queued_at` (timestamptz default now()), `started_at` (timestamptz), `completed_at` (timestamptz). Index on (status, priority). Partial index on queued_at where status = 'queued'.

---

**6. service_accounts**

Create table `service_accounts` with columns: `id` (UUID PK default gen_random_uuid()), `platform` (text), `handle` (text), `email` (text), `phone_number` (text), `storage_state` (jsonb), `storage_captured_at` (timestamptz), `storage_expires_at` (timestamptz), `status` (text default 'warming'), `proxy_assignment` (text), `device_fingerprint` (jsonb), `daily_action_count` (int default 0), `total_scrapes` (int default 0), `category_focus` (text), `geo_focus` (text), `warmed_at` (timestamptz), `created_at` (timestamptz default now()), `updated_at` (timestamptz default now()). UNIQUE on (platform, handle).

---

## After all 6 are created

Run: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('creators','brands','briefs','brief_creators','scrape_jobs','service_accounts');` — should return 6 rows. If your interface accepts SQL DDL directly, paste `db/schema.sql` instead — it has the same 6 tables plus all CHECK constraints and index definitions.
