# Influencer Intel — Project Details

## What It Is

Influencer Intel is a platform that helps brands discover, evaluate, and activate Instagram influencers for marketing campaigns. It covers the full lifecycle: search a directory of 5,000+ Indian creators, shortlist them against a campaign brief using AI-ranked scoring, predict content performance, and monitor live posts in real-time.

## Folder Location

```
/Users/salmansaudagar/VTO/influencer-intel/
```

## Monorepo Structure

```
influencer-intel/
├── shared/          # Shared types, DB client, LLM client, services
│   ├── types/       # Creator, Brief, OutcomeRecord, ConnectedAccount types (437 lines)
│   ├── db/          # BolticClient — Postgres wrapper (BOLTIC_DATABASE_URL)
│   ├── llm/         # OpenAI client (GPT-4o vision enrichment)
│   ├── ig-graph/    # Instagram Graph API OAuth integration
│   └── content-scorer/  # Content scoring service
│
├── scraper/         # Instagram data collection
│   └── src/
│       ├── playwright-driver.ts  # Camoufox/Playwright browser automation
│       ├── ig-extract.ts         # Profile + post data extraction
│       ├── orchestrator.ts       # Job coordination
│       ├── jobs/                 # Scrape job types
│       └── queue/                # Job queue management
│
├── platform/        # Next.js 15 web application (App Router, React 19)
│   ├── app/         # Pages and API routes (see below)
│   ├── lib/         # Core business logic services
│   └── components/  # Shared UI components
│
├── db/
│   └── migrations/  # SQL migration files (3 migrations)
│
├── validation/      # Data validation scripts
├── docs/            # Design specs and plans
└── .env             # Environment variables (BOLTIC_DATABASE_URL, OPENAI_API_KEY, etc.)
```

## Tech Stack

| Layer        | Technology                                            |
|-------------|------------------------------------------------------|
| Framework    | Next.js 15 (App Router) + React 19                   |
| Language     | TypeScript (101 source files)                        |
| Database     | PostgreSQL via BolticClient (Boltic managed Postgres) |
| Vector Search| pgvector — content_embedding cosine similarity       |
| AI/LLM       | GPT-4o (vision enrichment, brief parsing, ranking)   |
| Scraping     | Playwright + Camoufox (headless Firefox)             |
| Auth         | Cookie-based sessions (email + brand + IG handle)    |
| Styling      | Tailwind CSS — monochrome minimalist design          |
| Dev Server   | `npx next dev -p 3030` from `platform/` directory    |

## Database

17 tables in Postgres. Key tables and current row counts:

| Table               | Rows   | Purpose                                     |
|--------------------|--------|---------------------------------------------|
| creators            | 5,091  | Influencer profiles, metadata, embeddings   |
| briefs              | 25     | Campaign briefs with parsed parameters      |
| brief_creators      | —      | Many-to-many brief ↔ creator shortlist     |
| scrape_jobs         | 12,825 | Scraping job queue and status tracking      |
| connected_accounts  | 0      | Instagram Graph API OAuth connections       |
| stores              | 0      | Retail store locations for region targeting  |
| monitored_posts     | —      | Posts being tracked for real-time metrics   |
| post_insights       | —      | Checkpoint engagement data (30m/2h/6h/24h) |
| service_accounts    | —      | Instagram session cookies for scraping      |
| trend_signals       | —      | Trending audio/format detection             |
| brands              | —      | Registered brand accounts                   |

## Pages (11 routes)

| Route                           | Purpose                                           |
|--------------------------------|---------------------------------------------------|
| `/`                             | Landing page — search by handle, stats dashboard  |
| `/creators`                     | Discover — browse 4,782 creators with filters     |
| `/creators/[handle]`            | Creator detail (redirects to insights)            |
| `/insights/[handle]`            | 5-tab insights: Overview, Content, Brand Work, Predict, Monitor |
| `/predict`                      | Standalone prediction — find creator, run prediction |
| `/briefs`                       | Campaign briefs list — create new, import list    |
| `/shortlist/[id]`               | AI-ranked shortlist with match scores + reasoning |
| `/shortlist/[id]/compare`       | Side-by-side creator comparison table             |
| `/shortlist/[id]/outreach`      | Generate personalized DM/email drafts             |
| `/stores`                       | Store-based targeting — find influencers by city  |
| `/research`                     | Research dashboard                                |

## API Routes (26 endpoints)

**Creators & Insights**
- `GET /api/creators` — List/search creators with filters
- `GET /api/creators/[handle]` — Single creator profile
- `GET /api/creators/[handle]/similar` — Similar creators
- `GET /api/insights/[creatorId]` — Computed insights (scraped or connected)
- `GET /api/insights/[creatorId]/posts` — Post-level data

**Briefs & Shortlisting**
- `GET/POST /api/briefs` — List briefs / create new brief
- `GET /api/briefs/[id]` — Brief detail with shortlisted creators
- `GET /api/briefs/[id]/stream` — SSE stream for live shortlisting progress
- `GET /api/briefs/[id]/export` — Export shortlist as CSV/Excel
- `POST /api/briefs/[id]/outreach` — Generate outreach drafts
- `POST /api/briefs/import` — Excel/CSV import with auto-shortlisting
- `GET /api/briefs-list` — Lightweight brief list

**Prediction & Monitoring**
- `POST /api/predict/content` — Predict engagement for a creator
- `POST /api/predict/monitor` — Start monitoring a live post
- `POST /api/predict/post-analysis` — Analyze a specific post
- `POST /api/score/content` — Content scoring

**Stores**
- `GET/POST /api/stores` — List/search stores, bulk upsert
- `GET /api/stores/[id]/influencers` — Influencers near a store
- `POST /api/stores/suggest` — Find influencers for a city

**Auth & Infrastructure**
- `GET/POST /api/auth` — Session management
- `GET /api/oauth/instagram` — Instagram OAuth initiation
- `GET /api/oauth/instagram/callback` — OAuth callback
- `POST /api/scrape-callback` — Scraper completion webhook
- `POST /api/sync/trigger` — Manual data sync
- `GET /api/trends` — Trending content signals
- `POST /api/research` — Research queries
- `POST /api/admin/rerank` — Re-rank brief shortlists

## Core Services (platform/lib/)

| Service                  | File                   | Purpose                                                |
|-------------------------|------------------------|--------------------------------------------------------|
| Insights Service         | insights-service.ts    | Computes engagement metrics, time series, brand work detection from scraped or connected data |
| Prediction Engine        | prediction-engine.ts   | Phase 1 rule-based engagement prediction (baseline × timing × trend × competition multipliers) |
| Ranker                   | ranker.ts              | AI shortlisting — composite score (0.40 similarity + 0.20 filter + 0.10 credibility + 0.20 tier + verified boost) |
| Discovery                | discovery.ts           | Vector search over creator embeddings, freshness bucketing (fresh/stale/miss) |
| Reasoning                | reasoning.ts           | GPT-4o generates per-creator match explanations         |
| Shortlist Service        | shortlist-service.ts   | Orchestrates brief → discovery → ranking → persist pipeline |
| Monitoring Service       | monitoring-service.ts  | Real-time post tracking at 30m/2h/6h/24h checkpoints   |
| OAuth Service            | oauth-service.ts       | Instagram Graph API OAuth flow                          |
| Freshness                | freshness.ts           | On-demand re-scraping of stale creator profiles          |
| Entity Classifier        | entity-classifier.ts   | Classifies creators by category/niche                    |
| Sync Worker              | sync-worker.ts         | Background data synchronization                          |
| SSE Broadcaster          | sse-broadcaster.ts     | Server-sent events for live shortlisting progress        |

## Key Capabilities

### 1. Influencer Discovery
- 5,091 creators in database with GPT-4o vision-enriched metadata
- Vector similarity search using content_embedding (pgvector)
- Filter by follower size, category, city, verification status, credibility
- 12 posts scraped per creator with engagement metrics

### 2. AI-Ranked Shortlisting
- Natural language campaign briefs → auto-extract category, cities, audience, campaign type
- Brief embedding compared against creator content_embeddings
- Multi-factor scoring: similarity, filter match, credibility, tier, verification
- GPT-4o reasoning for each match ("why this creator fits")
- Live SSE progress streaming during research

### 3. Brand Work Detection (NEW)
- Detects paid partnerships, collab tags, brand mentions from GPT-4o vision data
- Sponsored post detection via regex patterns (#ad, #sponsored, #paidpartnership, etc.)
- Content themes extracted from post analysis

### 4. Excel/CSV Import (NEW)
- Upload a list of influencer handles in Excel (.xlsx) or CSV
- Auto-matches against creator database
- Optional campaign brief for auto-ranking imported creators
- Creates a real brief with shortlist if brief text provided

### 5. Store-Based Targeting (NEW)
- Find influencers popular near retail store locations
- Scoring: primary_city (+40), audience top_cities (pct×30), bio match (+10), city_tier (+10), brand experience (+5)
- CSV upload for bulk store import
- City-based suggestions without needing pre-loaded stores

### 6. Content Performance Prediction
- Phase 1: Rule-based prediction using baseline ER × multiplier factors
- Factors: content quality, timing, trend alignment, competition
- Shows predicted ER with confidence interval and factor breakdown
- Roadmap: Phase 2 (XGBoost with 35 features), Phase 3 (full ML)

### 7. Real-Time Monitoring
- Track live Instagram posts at 4 checkpoints: 30min, 2h, 6h, 24h
- Day-1 views predict Day-30 with 96% correlation
- Instagram post URL input → automated tracking

### 8. Creator Comparison & Outreach
- Side-by-side comparison: identity, reach, content, trust metrics
- Personalized DM/email draft generation
- Export shortlists as CSV/Excel

## Known Issues (as of 2026-05-29)

### Bugs
1. **Engagement chart shows 0.00%** — timeSeries engagement_rate stored as decimal, chart re-multiplies → near-zero. SVG NaN errors in console.
2. **Follower count missing/unformatted** — null follower_count renders empty; non-null renders raw number (274000000 instead of 274M).
3. **"Creator not found" page has no navigation** — bare error page, user stranded.
4. **Profile photos broken** — expired Instagram CDN URLs show broken image.

### Polish
5. Confidence label shows raw enum (`very_low` instead of "Very Low")
6. Shortlist back link says "← New brief" instead of "← Briefs"
7. Category tags on Discover page have inconsistent separators
8. "PENDING" badges on top creator cards not explained
9. Gender demographics don't show unknown/other category
10. "Insufficient data" for Trend despite 12 posts (cascade from bug #1)

### Data Gaps
11. Top creators (Virat Kohli, etc.) have empty engagement data — scraping didn't capture post-level metrics for many large accounts.

## Environment Variables (.env)

```
BOLTIC_DATABASE_URL=      # Postgres connection string
OPENAI_API_KEY=           # GPT-4o for vision enrichment + ranking
INSTAGRAM_APP_ID=         # Instagram Graph API OAuth
INSTAGRAM_APP_SECRET=     # Instagram Graph API OAuth
NEXT_PUBLIC_BASE_URL=     # Platform URL (http://localhost:3030)
```

## Running Locally

```bash
# From monorepo root
cd platform
ln -sf ../.env .env          # Symlink env vars
npx next dev -p 3030         # Start dev server on port 3030

# Scraper (separate terminal)
cd scraper
npm run dev

# Type checking (all workspaces)
npm run typecheck
```

## Architecture Decisions

- **No ORM** — raw SQL via BolticClient for performance and control
- **Embedding-first discovery** — pgvector cosine similarity over content_embedding, not keyword filters
- **GPT-4o vision enrichment** — each creator's posts analyzed for brand mentions, content themes, visual quality, vibe
- **Phased prediction** — Phase 1 (rule-based) ships immediately, ML phases require 50+ then 500+ connected accounts
- **Connected accounts unlock** — Instagram Graph API OAuth gives authorized metrics (saves, reach, impressions, audience demographics) that scraping can't access
- **Monochrome minimalist UI** — black/white/gray Tailwind design language throughout

---

# System Architecture

## Two-System Design

Influencer Intel is two cooperating systems sharing a single Boltic Postgres database:

```
LAPTOP                                BOLTIC (managed Postgres)            BRAND BROWSER
─────────────────                     ──────────────────────              ─────────────
Scraper                               ┌──────────────┐                    Web app (Next.js)
 Camoufox (hardened Firefox)          │   Tables     │                     │
 + Playwright           writes ─────▶ │   17 tables  │ ◀── reads ────────▶ │
 + service-account cookies            │   pgvector   │                     │
   walks IG handles                   └──────┬───────┘                     │
   extracts profile + posts                  │                            │
   enriches (GPT-4o vision)                  ▼                            │
   upserts creators            Next.js Serverless (platform)              │
        │                          brief → discovery → rank → SSE ◀───────┘
        └── webhook ─────────▶ POST /api/scrape-callback (re-rank waiting shortlists)
```

The scraper **writes** creator data; the platform **reads** it and **queues** new scrape jobs. The brand only ever touches the web app.

## Request Lifecycle — Brief → Shortlist

This is the core flow that defines the product:

1. **Brand submits a brief** (natural language) at `/briefs` → `POST /api/briefs`
2. **Parse** — GPT-4o extracts `ParsedBriefSpec` (category, target cities, languages, campaign type, vibe, reference creators) and generates a `brief_embedding`
3. **Discover** (`discovery.ts`) — pgvector cosine search over `creators.content_embedding` returns ~300 candidates, bucketed by freshness:
   - `fresh` (scraped < 90 days) → usable immediately
   - `stale` (14–90 days) → usable, but queue a background refresh
   - `miss` (never scraped / > 90 days) → queue an on-demand scrape job
4. **Rank** (`ranker.ts`) — composite score over candidates (formula below)
5. **Reason** (`reasoning.ts`) — GPT-4o writes a per-creator "why this fits" explanation
6. **Persist** — write `brief_creators` rows (rank, match_score, reasoning, freshness)
7. **Stream** — `GET /api/briefs/[id]/stream` pushes `ShortlistEvent`s over SSE so the brand sees creators appear live as the shortlist builds (preliminary → creator_added → reranked → progress → complete)
8. **On-demand backfill** — missed handles get scraped; `POST /api/scrape-callback` fires when done and triggers a re-rank of the waiting shortlist

Target: a credibility-scored shortlist with reasoning in **5–10 minutes**.

## Data-Source Tiers

Every creator carries a `data_tier` and insights carry a `confidence`. The system never fakes confidence:

| Source                       | What's available                                   | Confidence |
|-----------------------------|----------------------------------------------------|-----------|
| Connected (OAuth) + 30 posts | saves, reach, impressions, real demographics       | High      |
| Connected + < 30 posts       | private metrics, short history                     | Medium    |
| Scraped (12 posts)           | public metrics only (likes, comments, views)       | Low       |
| No history                   | content scores only — no bucket prediction         | Very Low  |

---

# Data Model

Mirrors `db/schema.sql` and `shared/types/index.ts` (437 lines). Six core tables plus growth-engine tables. Heavy use of JSONB so most creator data lives in a single row with no joins.

## creators (5,091 rows)
The central entity. Flat columns for the hot path (handle, follower_count, engagement_rate, primary_category, primary_city, city_tier, is_verified) plus rich JSONB:
- `recent_posts: RecentPost[]` — up to 12 posts with caption, type, timestamp, likes, comments, views
- `audience_demographics: AudienceDemographics` — gender split, age bands, top cities, languages (source: `inferred_scraping` or `verified_oauth`)
- `credibility: CredibilityData` — overall score 0–100, badge (green/amber/red), 10 signal sub-scores (engagement ratio, velocity, comment quality, geo authenticity, brand safety, etc.), flags
- `raw_metadata: CreatorRawMetadata` — extension-captured fields + **`vision: VisionEnrichment`** (GPT-4o reads the profile screenshot: niche, sub-niches, content_themes, brand_mentions, has_paid_partnership, has_collab_tag, vibe_tags, visual_quality_score)
- `content_embedding: number[]` — pgvector column for similarity search
- `verified_oauth_data` — encrypted OAuth tokens + Graph API insights when connected

## briefs (25 rows)
`raw_text` + `parsed_spec: ParsedBriefSpec` + `brief_embedding` + status (`pending → parsed → shortlisted → archived`).

## brief_creators (the shortlist)
Join row: `rank`, `match_score`, `reasoning`, `freshness`, plus lifecycle JSONB — `outreach: OutreachRecord` (channel, draft, status from draft→sent→replied→confirmed) and `outcome: OutcomeRecord` (predicted vs actual ER, reach, saves, shares, brand rating). `brand_action`: selected / dropped / pending.

## scrape_jobs (12,825 rows)
The work queue. `job_type` ∈ {on_demand, refresh, audience_inference, discovery_crawl, search_query, comment_sample, credibility_recompute}, `priority`, `status` (queued→in_progress→completed/failed/skipped), `attempts`, `assigned_account_id`.

## service_accounts
Instagram accounts used for scraping. `storage_state` (encrypted cookies/localStorage), `status` (warming→active→flagged→banned→retired), proxy assignment, device fingerprint, daily_action_count. Never the user's personal IG.

## brands
Brand orgs with `users: BrandUser[]` (encrypted Gmail/IG OAuth tokens), `plan` (design_partner/growth/scale), research quota tracking.

## Growth-engine tables
`connected_accounts` (0 rows — OAuth links), `monitored_posts` + `post_insights` (real-time checkpoint data), `trend_signals` (trending audio/format with lifecycle phase + velocity).

## Encryption
`shared/db/encryption.ts` wraps Boltic SQL functions (`boltic_encrypt`, `boltic_encrypt_searchable`, `boltic_decrypt`) for sensitive columns: service-account storage_state, verified_oauth_data, OAuth tokens.

---

# Ranking Algorithm (ranker.ts)

**Quality gates** drop non-viable creators before scoring:
- Follower count ≥ 5,000
- Following/follower ratio ≤ 1.5 (fake-account signal)
- Credibility badge ≠ red
- Not a shop or brand_account (via `entity-classifier.ts` — brands hire influencers, not retailers)

**Composite score** (0–100):

```
match_score = 100 × ( 0.40 × similarity        // pgvector cosine, brief ↔ creator embedding
                    + 0.20 × filterScore        // category/city/language gate multipliers
                    + 0.10 × credScore          // credibility / 100
                    + 0.20 × tierScore          // log-scale follower boost
                    + verifiedBoost )           // +0.08 if IG-verified
```

**filterScore** starts at 1.0 and is multiplied down:
- Category: exact match (no penalty), adjacent like beauty↔skincare (×0.7), off-brief like tech↔fashion (×0.35). Adjacency map is explicit because vector similarity alone pulls neighboring niches.
- City miss ×0.7, language miss ×0.85, ambiguous shop ×0.7, red credibility ×0.4

**tierScore** by follower count: mega 1M+ = 1.0, macro 100K+ = 0.85, micro 20K+ = 0.62, nano = 0.4. Right default for premium D2C; micro briefs can override.

Output sorted descending; `signals[]` carries human-readable reasons ("exact category match", "based in Mumbai", "verified", "credibility 87%").

---

# Prediction Engine (prediction-engine.ts)

Phase-1 **rule-based** implementation of the spec's formula. Multiplicative:

```
predicted_ER = creator_baseline
             × content_multiplier      // [0.5, 2.0] from Gemini 12-dim score (1.0 if no scores)
             × temporal_multiplier      // [0.85, 1.15] from best posting hour/day alignment
             × trend_multiplier         // [0.7, 1.5] from trend_signals phase + content trend_leverage
             × competition_multiplier   // [0.9, 1.1] from peak-hour/weekday density estimate
```

- **creator_baseline** = rolling 30d ER → rolling 90d ER → creator ER → 0.02 fallback
- **Buckets** assigned relative to the creator's own 90-day history: ratio ≥ 2.0 = breakout, ≥ 1.3 = above_average, ≥ 0.7 = average, else below_average. With no history, falls back to absolute thresholds (≥8% breakout, etc.)
- **Confidence interval** widens as data thins: high ±0.3, medium ±0.5, low ±0.8, very_low ±1.2
- Returns factor breakdown for explainability + optimal_post_window + improvement_suggestions

The UI's factor bars (Baseline / Content / Timing / Trend / Competition) render these multipliers directly.

---

# Scraper Pipeline

**Stack:** Camoufox (anti-fingerprint hardened Firefox) driven by Playwright. The legacy Chrome MV3 extension (`scraper/extension/`) is kept in-repo but no longer loaded — extraction logic now runs in-page via `page.evaluate()`.

**Flow:** orchestrator polls the `scrape_jobs` queue (dual-priority: on_demand/refresh preempt background crawls) → Camoufox launches with service-account cookies hydrated from `storage_state` → navigates to the IG profile/hashtag/search → `ig-extract.ts` pulls og:meta + DOM selectors (50+ fields: follower count, tier, language inference, Indian inference, recent posts, highlights) → enrichment (GPT-4o vision on screenshot, geo signals, audience inference, credibility) → upserts the `creators` row → `platform-notify.ts` POSTs an HMAC-signed webhook to `/api/scrape-callback` (3 retries, exponential backoff) → platform re-ranks any waiting shortlist.

**Auth:** service accounts loaded at startup, most-recent active `storage_state` injected into the browser context. Sessions captured via `npm run scraper:capture`. Rate-limited to ~300 actions/hour. Idle scraper auto-enqueues creators stale > 14 days.

**Key modules:** `orchestrator.ts` (main loop), `playwright-driver.ts` (Camoufox launch + human-like navigation), `ig-extract.ts` (in-page extraction), `queue/worker.ts` (priority claim + rate limiter), `jobs/*` (per-type handlers).

---

# Design Specs & Plans

Located in `docs/superpowers/`:

| File | Lines | What |
|------|-------|------|
| `specs/2026-05-22-content-growth-engine-design.md` | 423 | Full design spec for the prediction + optimization engine |
| `plans/2026-05-22-content-growth-engine-phase1.md` | 1,864 | Task-by-task TDD implementation plan for Phase 1 |

## The Content Growth Engine (the product's north star)

A prediction + optimization engine for organic content performance — "Will this content perform well, and when/how should we publish it?" Analogous to Tempo (for paid ads) but for organic/influencer content.

### The Honest Math — variance decomposition (from research)

| Factor | Variance Explained |
|--------|-------------------|
| Creator history (baseline, audience, consistency) | 30–40% |
| Content quality (hook, retention, production) | 10–20% |
| Social influence cascades (early sharing) | 15–25% |
| Algorithmic amplification (IG's ML) | 10–15% |
| Clock time (hour, day, season, competition) | 2–5% |
| Irreducible stochastic noise | 10–20% |

**Key constraint (Hofman-Watts, Science 2017):** ~50% of performance variance is fundamentally unpredictable. So the system predicts **ranges and buckets**, never points. Achievable accuracy ranges from PR AUC 0.13 (content-only) to 0.65–0.75 (real-time 2hr early engagement).

### Performance buckets
Breakout (top 10%, > creator p90) · Above Average (p65–p90) · Average (p35–p65) · Below Average (< p35).

### Phased rollout
- **Phase 1 — Insights Engine (no ML):** dashboards of real performance data. Generates the connected-account data that trains later phases. *(This is what's built.)*
- **Phase 2 — Calibrated Scoring (50+ connected accounts):** global XGBoost baseline + Gemini 2.5 Flash content scoring (12 dimensions) + temporal features. Target 55% bucket accuracy.
- **Phase 3 — Full Prediction (500+ accounts):** per-creator calibrated models, real-time refinement, trend detection, what-if simulator. Target 70%.

### Why XGBoost, not deep learning
Research: XGBoost beats deep learning on tabular engagement prediction (PR AUC 0.43 vs CLIP 0.10). Deep learning only helps for raw content features — handled separately by Gemini scoring. Planned feature vector: **35 features** (9 creator + 12 content + 8 temporal + 3 trend + 3 cross).

### Connected-account unlock (Instagram Graph API)
OAuth on Business/Creator accounts (1000+ followers) gives authorized metrics scraping can't see: **saves** (strongest value signal), **shares/sends** (3–5× weight of likes per Mosseri 2024), reach vs impressions, Reels skip rate, real audience demographics. Rate limit: 200 calls/hr/account. This is the key data unlock the architecture is designed around.

### Explicitly NOT building
Follower prediction · competitor private-data scraping · automated posting · content generation · cross-platform (Instagram only for v1).

---

# Development Workflow & Skills

This project is built using the **superpowers** skill suite, which enforces a disciplined spec → plan → implement flow:

1. **brainstorming** → collaborative dialogue refines an idea into a design, saved to `docs/superpowers/specs/`. (Used for the connected-account architecture and Content Growth Engine.)
2. **writing-plans** → turns the approved spec into a bite-sized, TDD, task-by-task plan in `docs/superpowers/plans/`.
3. **executing-plans / subagent-driven-development** → implements task-by-task with review between tasks.
4. **deep-research** → multi-source research harness (used for the Instagram algorithm / engagement-prediction research that grounds "The Honest Math").

Other relevant skills available in this environment: systematic-debugging, test-driven-development, verification-before-completion, requesting/receiving-code-review, using-git-worktrees.

## Git workflow conventions (from user's global rules)
- Branch before committing if on the default branch; commit/push only when asked
- Run typecheck after code changes: `npm run typecheck` (all three workspaces)
- Inject checks pre-push; no phase-plan files committed to the repo

## Commit history (recent)
```
b34fa4e Relax freshness threshold: show creators scraped within 90 days
68257b3 Add New Brief creation form to briefs page
36854e3 Fix OAuth URL, type errors, and missing exports for Growth Engine
1f3e9d1 On-demand scraping: refresh stale creators when users search or view
9fa3dab Influencer Intel: full platform + scraper + post analysis
264a222 Content Growth Engine — all 3 phases: insights, prediction, monitoring
a3969ff Content Growth Engine design spec
```

---

# Quick Reference

| Need | Where |
|------|-------|
| Add a page | `platform/app/<route>/page.tsx` |
| Add an API endpoint | `platform/app/api/<route>/route.ts` |
| Change ranking logic | `platform/lib/ranker.ts` |
| Change prediction logic | `platform/lib/prediction-engine.ts` |
| Change insights computation | `platform/lib/insights-service.ts` |
| Add a DB column / table | `db/migrations/*.sql` + `shared/types/index.ts` |
| Shared types | `shared/types/index.ts` + `shared/types/growth-engine.ts` |
| DB client methods | `shared/db/boltic-client.ts` |
| Scraper extraction fields | `scraper/src/ig-extract.ts` |
| Nav links | `platform/components/app-header.tsx` |
| Run the app | `cd platform && npx next dev -p 3030` |
| Typecheck everything | `npm run typecheck` |
