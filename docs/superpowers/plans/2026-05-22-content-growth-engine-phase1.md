# Content Growth Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Connected Accounts foundation + Insights Engine — Instagram Graph API OAuth, private metrics ingestion, creator analytics computation, content scoring via Gemini, and the analytics dashboard. This delivers standalone value (real engagement data + content scoring) on Day 1, and is the prerequisite for Phase 2 (prediction) and Phase 3 (real-time monitoring).

**Architecture:** Creators/brands connect their Instagram Business/Creator account via OAuth. The system backfills historical post data with private metrics (saves, reach, impressions, shares) from the Graph API. A background sync worker keeps data fresh. Content is scored on 12 dimensions via Gemini 2.5 Flash. All insights are served through new API endpoints and displayed on an analytics dashboard page.

**Tech Stack:** TypeScript (monorepo), Next.js 15 (platform), Instagram Graph API, Gemini 2.5 Flash API, PostgreSQL/Boltic, existing BolticClient + OpenAIClient patterns.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `shared/types/growth-engine.ts` | All new types: ConnectedAccount, PostInsight, ContentScore, CreatorInsights, PredictionResult |
| `shared/ig-graph/client.ts` | Instagram Graph API client — token refresh, rate limiting, all endpoint wrappers |
| `shared/ig-graph/types.ts` | Raw Graph API response shapes |
| `shared/content-scorer/gemini-client.ts` | Gemini 2.5 Flash content scoring — 12-dimension analysis |
| `platform/lib/oauth-service.ts` | OAuth flow: build auth URL, exchange code for token, persist |
| `platform/lib/insights-service.ts` | Compute derived metrics: breakout rate, rolling ER, consistency, growth |
| `platform/lib/sync-worker.ts` | Background data sync: backfill on connect, daily/weekly refresh |
| `platform/app/api/oauth/instagram/route.ts` | GET — redirect to Instagram OAuth consent screen |
| `platform/app/api/oauth/instagram/callback/route.ts` | GET — handle OAuth callback, exchange code, persist tokens |
| `platform/app/api/insights/[creatorId]/route.ts` | GET — creator insights (breakout rate, rolling ER, audience quality) |
| `platform/app/api/insights/[creatorId]/posts/route.ts` | GET — paginated post library with private metrics |
| `platform/app/api/score/content/route.ts` | POST — score content via Gemini 2.5 Flash |
| `platform/app/api/sync/trigger/route.ts` | POST — manually trigger data sync for a connected account |
| `platform/app/insights/[handle]/page.tsx` | Creator insights dashboard page |
| `db/migrations/001-connected-accounts.sql` | New table: connected_accounts + post_insights |

### Modified Files

| File | Change |
|------|--------|
| `shared/types/index.ts` | Re-export from growth-engine.ts |
| `db/schema.sql` | Append connected_accounts + post_insights tables |
| `platform/app/creators/[handle]/page.tsx` | Add "Connect Account" CTA + insights link |

---

### Task 1: Growth Engine Types

**Files:**
- Create: `shared/types/growth-engine.ts`
- Modify: `shared/types/index.ts`

- [ ] **Step 1: Create growth engine types file**

```typescript
// shared/types/growth-engine.ts

export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';
export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';
export type PerformanceBucket = 'breakout' | 'above_average' | 'average' | 'below_average';
export type InsightConfidence = 'high' | 'medium' | 'low' | 'very_low';

export interface ConnectedAccount {
  id: string;
  creator_id: string;
  brand_id: string | null;
  ig_user_id: string;
  ig_username: string;
  access_token_encrypted: string;
  token_expires_at: string | null;
  scopes: string[];
  connection_status: ConnectionStatus;
  last_sync_at: string | null;
  last_sync_status: SyncStatus;
  sync_error: string | null;
  posts_synced_count: number;
  connected_at: string;
  updated_at: string;
}

export interface PostInsight {
  id: string;
  connected_account_id: string;
  creator_id: string;
  ig_media_id: string;
  ig_shortcode: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  media_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  permalink: string;
  posted_at: string;

  // Public metrics
  like_count: number;
  comment_count: number;
  
  // Private metrics (Graph API only)
  reach: number | null;
  impressions: number | null;
  saved: number | null;
  shares: number | null;
  plays: number | null;
  total_interactions: number | null;

  // Computed
  engagement_rate: number | null;
  performance_bucket: PerformanceBucket | null;

  // Content scoring (Gemini)
  content_scores: ContentScores | null;
  content_scored_at: string | null;

  fetched_at: string;
  insights_fetched_at: string | null;
}

export interface ContentScores {
  hook_strength: number;
  retention_design: number;
  information_density: number;
  emotional_trigger: number;
  production_quality: number;
  trend_leverage: number;
  brand_integration: number;
  cta_effectiveness: number;
  audio_fit: number;
  shareability: number;
  comment_magnetism: number;
  niche_authority: number;
  overall_weighted: number;
  improvement_suggestions: string[];
}

export interface CreatorInsights {
  creator_id: string;
  connected_account_id: string;

  // Rolling engagement
  rolling_er_30d: number | null;
  rolling_er_90d: number | null;
  
  // Breakout analysis
  breakout_rate: number | null;
  breakout_threshold: number | null;
  
  // Consistency
  consistency_score: number | null;
  er_coefficient_of_variation: number | null;
  
  // Growth
  follower_growth_30d: number | null;
  follower_growth_90d: number | null;
  
  // Content cadence
  posts_per_week: number | null;
  avg_days_between_posts: number | null;
  
  // Audience quality (from Graph API demographics)
  audience_quality_score: number | null;
  audience_demographics: {
    gender: { male_pct: number; female_pct: number };
    top_age_band: string;
    top_cities: Array<{ city: string; pct: number }>;
    top_countries: Array<{ country: string; pct: number }>;
  } | null;

  // Best/worst content
  top_posts: Array<{ ig_shortcode: string; er: number; bucket: PerformanceBucket }>;
  worst_posts: Array<{ ig_shortcode: string; er: number; bucket: PerformanceBucket }>;

  // Optimal posting
  best_posting_hours: number[];
  best_posting_days: number[];

  computed_at: string;
  confidence: InsightConfidence;
}

export interface ContentScoreRequest {
  media_url: string;
  media_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';
  caption?: string;
  creator_category?: string;
}

export interface ContentScoreResponse {
  scores: ContentScores;
  overall_bucket_estimate: PerformanceBucket;
  confidence: InsightConfidence;
}
```

- [ ] **Step 2: Re-export from shared types index**

Add to the bottom of `shared/types/index.ts`:

```typescript
export * from './growth-engine';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/salmansaudagar/VTO/influencer-intel && npx tsc --noEmit -p shared/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add shared/types/growth-engine.ts shared/types/index.ts
git commit -m "feat(growth-engine): add types for connected accounts, post insights, content scoring"
```

---

### Task 2: Database Schema — Connected Accounts + Post Insights

**Files:**
- Create: `db/migrations/001-connected-accounts.sql`
- Modify: `db/schema.sql`

- [ ] **Step 1: Create migration file**

```sql
-- db/migrations/001-connected-accounts.sql
-- Connected Accounts + Post Insights for Content Growth Engine Phase 1

-- ============================================================
-- 7. CONNECTED_ACCOUNTS — OAuth-connected IG accounts
-- ============================================================

CREATE TABLE connected_accounts (
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

CREATE INDEX idx_connected_accounts_creator ON connected_accounts(creator_id);
CREATE INDEX idx_connected_accounts_status  ON connected_accounts(connection_status);

-- ============================================================
-- 8. POST_INSIGHTS — per-post metrics from Graph API
-- ============================================================

CREATE TABLE post_insights (
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

  -- Public metrics
  like_count               INTEGER NOT NULL DEFAULT 0,
  comment_count            INTEGER NOT NULL DEFAULT 0,

  -- Private metrics (Graph API insights)
  reach                    INTEGER,
  impressions              INTEGER,
  saved                    INTEGER,
  shares                   INTEGER,
  plays                    INTEGER,
  total_interactions       INTEGER,

  -- Computed
  engagement_rate          NUMERIC(7,6),
  performance_bucket       TEXT CHECK (performance_bucket IN ('breakout', 'above_average', 'average', 'below_average')),

  -- Content scoring (Gemini 2.5 Flash)
  content_scores           JSONB,
  content_scored_at        TIMESTAMPTZ,

  fetched_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  insights_fetched_at      TIMESTAMPTZ,

  UNIQUE (connected_account_id, ig_media_id)
);

CREATE INDEX idx_post_insights_creator     ON post_insights(creator_id, posted_at DESC);
CREATE INDEX idx_post_insights_account     ON post_insights(connected_account_id, posted_at DESC);
CREATE INDEX idx_post_insights_shortcode   ON post_insights(ig_shortcode);
CREATE INDEX idx_post_insights_bucket      ON post_insights(performance_bucket) WHERE performance_bucket IS NOT NULL;

-- Also update scrape_jobs check constraint to include 'search_query' (already used in code)
ALTER TABLE scrape_jobs DROP CONSTRAINT IF EXISTS scrape_jobs_job_type_check;
ALTER TABLE scrape_jobs ADD CONSTRAINT scrape_jobs_job_type_check
  CHECK (job_type IN (
    'on_demand', 'refresh', 'audience_inference',
    'discovery_crawl', 'comment_sample', 'credibility_recompute',
    'search_query'
  ));
```

- [ ] **Step 2: Append table definitions to schema.sql**

Add to the end of `db/schema.sql` (before the Notes section):

```sql
-- ============================================================
-- 7. CONNECTED_ACCOUNTS — OAuth-linked IG Business/Creator accounts
-- ============================================================
-- (See db/migrations/001-connected-accounts.sql for full DDL)

-- ============================================================
-- 8. POST_INSIGHTS — per-post metrics from Graph API
-- ============================================================
-- (See db/migrations/001-connected-accounts.sql for full DDL)
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/001-connected-accounts.sql db/schema.sql
git commit -m "feat(db): add connected_accounts + post_insights tables for growth engine"
```

---

### Task 3: Instagram Graph API Client

**Files:**
- Create: `shared/ig-graph/types.ts`
- Create: `shared/ig-graph/client.ts`

- [ ] **Step 1: Create Graph API response types**

```typescript
// shared/ig-graph/types.ts

export interface IGTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface IGLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface IGUserProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  website?: string;
}

export interface IGMedia {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  shortcode: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface IGMediaInsight {
  name: string;
  period: string;
  values: Array<{ value: number }>;
  title: string;
}

export interface IGMediaInsightsResponse {
  data: IGMediaInsight[];
}

export interface IGPaginatedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
}

export interface IGAudienceDemographic {
  name: string;
  period: string;
  values: Array<{
    value: Record<string, number>;
    end_time?: string;
  }>;
}
```

- [ ] **Step 2: Create Graph API client**

```typescript
// shared/ig-graph/client.ts

import type {
  IGTokenResponse,
  IGLongLivedTokenResponse,
  IGUserProfile,
  IGMedia,
  IGMediaInsightsResponse,
  IGPaginatedResponse,
  IGAudienceDemographic,
} from './types';

const GRAPH_API_BASE = 'https://graph.instagram.com';
const GRAPH_API_VERSION = 'v21.0';

interface RateLimitState {
  remaining: number;
  resetAt: number;
}

export class IGGraphClient {
  private accessToken: string;
  private rateLimitState: RateLimitState = { remaining: 200, resetAt: 0 };

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    await this.waitForRateLimit();

    const url = new URL(`${GRAPH_API_BASE}/${GRAPH_API_VERSION}${path}`);
    url.searchParams.set('access_token', this.accessToken);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString());
    this.updateRateLimit(res.headers);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`IG Graph API ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  private updateRateLimit(headers: Headers): void {
    const usage = headers.get('x-business-use-case-usage');
    if (!usage) return;
    try {
      const parsed = JSON.parse(usage);
      const values = Object.values(parsed) as Array<Array<{
        call_count: number;
        total_cputime: number;
        total_time: number;
        estimated_time_to_regain_access?: number;
      }>>;
      const first = values[0]?.[0];
      if (first) {
        this.rateLimitState.remaining = Math.max(0, 200 - (first.call_count * 2));
        if (first.estimated_time_to_regain_access) {
          this.rateLimitState.resetAt = Date.now() + first.estimated_time_to_regain_access * 60_000;
        }
      }
    } catch { /* ignore parse errors */ }
  }

  private async waitForRateLimit(): Promise<void> {
    if (this.rateLimitState.remaining <= 5) {
      const waitMs = Math.max(0, this.rateLimitState.resetAt - Date.now());
      if (waitMs > 0) {
        console.log(`[ig-graph] Rate limit near, waiting ${Math.round(waitMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  // --- OAuth token management ---

  static async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<IGTokenResponse> {
    const res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
    return res.json() as Promise<IGTokenResponse>;
  }

  static async exchangeForLongLived(
    shortLivedToken: string,
    clientSecret: string,
  ): Promise<IGLongLivedTokenResponse> {
    const url = new URL(`${GRAPH_API_BASE}/access_token`);
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', clientSecret);
    url.searchParams.set('access_token', shortLivedToken);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Long-lived token exchange failed: ${await res.text()}`);
    return res.json() as Promise<IGLongLivedTokenResponse>;
  }

  async refreshToken(): Promise<IGLongLivedTokenResponse> {
    const url = new URL(`${GRAPH_API_BASE}/refresh_access_token`);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', this.accessToken);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
    const data = await res.json() as IGLongLivedTokenResponse;
    this.accessToken = data.access_token;
    return data;
  }

  // --- User profile ---

  async getProfile(): Promise<IGUserProfile> {
    return this.request<IGUserProfile>('/me', {
      fields: 'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website',
    });
  }

  // --- Media ---

  async getMedia(limit = 25, after?: string): Promise<IGPaginatedResponse<IGMedia>> {
    const params: Record<string, string> = {
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,shortcode,timestamp,like_count,comments_count',
      limit: String(limit),
    };
    if (after) params.after = after;
    return this.request<IGPaginatedResponse<IGMedia>>('/me/media', params);
  }

  async getAllMedia(maxPosts = 200): Promise<IGMedia[]> {
    const all: IGMedia[] = [];
    let after: string | undefined;
    while (all.length < maxPosts) {
      const batch = await this.getMedia(25, after);
      all.push(...batch.data);
      if (!batch.paging?.cursors?.after || batch.data.length === 0) break;
      after = batch.paging.cursors.after;
    }
    return all.slice(0, maxPosts);
  }

  // --- Media insights ---

  async getMediaInsights(mediaId: string, mediaType: string): Promise<IGMediaInsightsResponse> {
    const isReel = mediaType === 'VIDEO' || mediaType === 'REELS';
    const metrics = isReel
      ? 'reach,plays,saved,shares,total_interactions,likes,comments'
      : 'reach,impressions,saved,total_interactions,likes,comments';
    return this.request<IGMediaInsightsResponse>(`/${mediaId}/insights`, { metric: metrics });
  }

  // --- Audience demographics ---

  async getAudienceDemographics(): Promise<{
    gender_age: Record<string, number>;
    cities: Record<string, number>;
    countries: Record<string, number>;
  }> {
    const [genderAge, cities, countries] = await Promise.all([
      this.request<{ data: IGAudienceDemographic[] }>('/me/insights', {
        metric: 'follower_demographics',
        period: 'lifetime',
        metric_type: 'total_value',
        breakdown: 'age,gender',
      }).catch(() => ({ data: [] })),
      this.request<{ data: IGAudienceDemographic[] }>('/me/insights', {
        metric: 'follower_demographics',
        period: 'lifetime',
        metric_type: 'total_value',
        breakdown: 'city',
      }).catch(() => ({ data: [] })),
      this.request<{ data: IGAudienceDemographic[] }>('/me/insights', {
        metric: 'follower_demographics',
        period: 'lifetime',
        metric_type: 'total_value',
        breakdown: 'country',
      }).catch(() => ({ data: [] })),
    ]);

    return {
      gender_age: genderAge.data[0]?.values[0]?.value ?? {},
      cities: cities.data[0]?.values[0]?.value ?? {},
      countries: countries.data[0]?.values[0]?.value ?? {},
    };
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/salmansaudagar/VTO/influencer-intel && npx tsc --noEmit -p shared/tsconfig.json`
Expected: No errors (may need to add `"lib": ["ES2022", "DOM"]` to shared/tsconfig.json for `fetch`)

- [ ] **Step 4: Commit**

```bash
git add shared/ig-graph/
git commit -m "feat(ig-graph): Instagram Graph API client with rate limiting, OAuth, media + insights endpoints"
```

---

### Task 4: OAuth Service

**Files:**
- Create: `platform/lib/oauth-service.ts`
- Create: `platform/app/api/oauth/instagram/route.ts`
- Create: `platform/app/api/oauth/instagram/callback/route.ts`

- [ ] **Step 1: Create OAuth service**

```typescript
// platform/lib/oauth-service.ts

import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph/client';
import type { ConnectedAccount, Creator } from '@influencer-intel/shared/types';

const IG_APP_ID = process.env.IG_APP_ID!;
const IG_APP_SECRET = process.env.IG_APP_SECRET!;
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI!;

const OAUTH_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: IG_APP_ID,
    redirect_uri: IG_REDIRECT_URI,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

export async function handleOAuthCallback(
  code: string,
  state: string,
): Promise<ConnectedAccount> {
  const db = getBolticClient();

  // Exchange code for short-lived token
  const shortToken = await IGGraphClient.exchangeCodeForToken(
    code,
    IG_APP_ID,
    IG_APP_SECRET,
    IG_REDIRECT_URI,
  );

  // Exchange for long-lived token (60 days)
  const longToken = await IGGraphClient.exchangeForLongLived(
    shortToken.access_token,
    IG_APP_SECRET,
  );

  // Get user profile
  const client = new IGGraphClient(longToken.access_token);
  const profile = await client.getProfile();

  // Find or create creator row
  let creators = await db.query<Creator>(
    `SELECT * FROM creators WHERE platform = 'instagram' AND handle = $1 LIMIT 1`,
    [profile.username],
  );
  let creator: Creator;
  if (creators.length === 0) {
    creator = await db.insert<Creator>('creators', {
      platform: 'instagram',
      handle: profile.username,
      profile_url: `https://www.instagram.com/${profile.username}/`,
      display_name: profile.name ?? null,
      bio: profile.biography ?? null,
      profile_photo_url: profile.profile_picture_url ?? null,
      is_verified: false,
      follower_count: profile.followers_count ?? null,
      following_count: profile.follows_count ?? null,
      posts_count: profile.media_count ?? null,
      is_active: true,
      data_tier: 'tier_a',
    });
  } else {
    creator = creators[0]!;
    await db.update<Creator>('creators', { id: creator.id }, {
      data_tier: 'tier_a',
      follower_count: profile.followers_count ?? creator.follower_count,
      display_name: profile.name ?? creator.display_name,
      bio: profile.biography ?? creator.bio,
      profile_photo_url: profile.profile_picture_url ?? creator.profile_photo_url,
    });
  }

  // Parse state for brand_id
  let brandId: string | null = null;
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    brandId = parsed.brand_id ?? null;
  } catch { /* state parsing optional */ }

  const expiresAt = new Date(Date.now() + longToken.expires_in * 1000).toISOString();

  // Upsert connected account
  const account = await db.upsert<ConnectedAccount>('connected_accounts', {
    creator_id: creator.id,
    brand_id: brandId,
    ig_user_id: profile.id,
    ig_username: profile.username,
    access_token_encrypted: longToken.access_token,
    token_expires_at: expiresAt,
    scopes: OAUTH_SCOPES.split(','),
    connection_status: 'active',
    last_sync_status: 'pending',
    updated_at: new Date().toISOString(),
  }, ['ig_user_id']);

  return account;
}
```

- [ ] **Step 2: Create OAuth initiation route**

```typescript
// platform/app/api/oauth/instagram/route.ts

import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/oauth-service';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand_id');

  const state = Buffer.from(JSON.stringify({
    brand_id: brandId,
    ts: Date.now(),
  })).toString('base64url');

  const authUrl = buildAuthUrl(state);
  return NextResponse.redirect(authUrl);
}
```

- [ ] **Step 3: Create OAuth callback route**

```typescript
// platform/app/api/oauth/instagram/callback/route.ts

import { NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/oauth-service';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const error = url.searchParams.get('error');

  if (error || !code) {
    const reason = url.searchParams.get('error_reason') ?? 'unknown';
    return NextResponse.redirect(
      new URL(`/creators?oauth_error=${encodeURIComponent(reason)}`, request.url),
    );
  }

  try {
    const account = await handleOAuthCallback(code, state);
    return NextResponse.redirect(
      new URL(`/insights/${account.ig_username}?connected=true`, request.url),
    );
  } catch (err) {
    console.error('[oauth] callback failed:', err);
    return NextResponse.redirect(
      new URL(`/creators?oauth_error=token_exchange_failed`, request.url),
    );
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add platform/lib/oauth-service.ts platform/app/api/oauth/
git commit -m "feat(oauth): Instagram OAuth flow — consent redirect + callback token exchange"
```

---

### Task 5: Data Sync Worker — Backfill + Refresh

**Files:**
- Create: `platform/lib/sync-worker.ts`
- Create: `platform/app/api/sync/trigger/route.ts`

- [ ] **Step 1: Create sync worker**

```typescript
// platform/lib/sync-worker.ts

import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph/client';
import type { ConnectedAccount, PostInsight } from '@influencer-intel/shared/types';

export async function syncConnectedAccount(accountId: string): Promise<{
  postsAdded: number;
  insightsUpdated: number;
}> {
  const db = getBolticClient();
  const account = await db.findById<ConnectedAccount>('connected_accounts', accountId);
  if (!account || account.connection_status !== 'active') {
    throw new Error(`Account ${accountId} not found or not active`);
  }

  await db.update('connected_accounts', { id: accountId }, {
    last_sync_status: 'syncing',
    updated_at: new Date().toISOString(),
  });

  try {
    const client = new IGGraphClient(account.access_token_encrypted);
    
    // Fetch all media (up to 200 posts)
    const media = await client.getAllMedia(200);
    let postsAdded = 0;
    let insightsUpdated = 0;

    for (const post of media) {
      const row: Partial<PostInsight> = {
        connected_account_id: accountId,
        creator_id: account.creator_id,
        ig_media_id: post.id,
        ig_shortcode: post.shortcode,
        media_type: post.media_type as PostInsight['media_type'],
        media_url: post.media_url ?? null,
        thumbnail_url: post.thumbnail_url ?? null,
        caption: post.caption ?? null,
        permalink: post.permalink,
        posted_at: post.timestamp,
        like_count: post.like_count ?? 0,
        comment_count: post.comments_count ?? 0,
        fetched_at: new Date().toISOString(),
      };

      // Fetch insights for this post (private metrics)
      try {
        const insights = await client.getMediaInsights(post.id, post.media_type);
        for (const metric of insights.data) {
          const val = metric.values[0]?.value ?? 0;
          switch (metric.name) {
            case 'reach': row.reach = val; break;
            case 'impressions': row.impressions = val; break;
            case 'saved': row.saved = val; break;
            case 'shares': row.shares = val; break;
            case 'plays': row.plays = val; break;
            case 'total_interactions': row.total_interactions = val; break;
          }
        }
        row.insights_fetched_at = new Date().toISOString();
        insightsUpdated++;
      } catch (err) {
        console.warn(`[sync] insights failed for media ${post.id}:`, (err as Error).message);
      }

      // Compute engagement rate
      const followerCount = (await db.findById<{ follower_count: number }>('creators', account.creator_id))?.follower_count;
      if (followerCount && followerCount > 0) {
        const interactions = (row.like_count ?? 0) + (row.comment_count ?? 0) + (row.saved ?? 0) + (row.shares ?? 0);
        row.engagement_rate = interactions / followerCount;
      }

      await db.upsert('post_insights', row as Record<string, unknown>, ['connected_account_id', 'ig_media_id']);
      postsAdded++;
    }

    // Fetch audience demographics and update creator
    try {
      const demographics = await client.getAudienceDemographics();
      await updateCreatorDemographics(account.creator_id, demographics);
    } catch (err) {
      console.warn(`[sync] demographics failed:`, (err as Error).message);
    }

    // Assign performance buckets
    await assignPerformanceBuckets(accountId);

    await db.update('connected_accounts', { id: accountId }, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'completed',
      posts_synced_count: postsAdded,
      sync_error: null,
      updated_at: new Date().toISOString(),
    });

    return { postsAdded, insightsUpdated };
  } catch (err) {
    await db.update('connected_accounts', { id: accountId }, {
      last_sync_status: 'failed',
      sync_error: (err as Error).message,
      updated_at: new Date().toISOString(),
    });
    throw err;
  }
}

async function assignPerformanceBuckets(accountId: string): Promise<void> {
  const db = getBolticClient();
  const posts = await db.query<PostInsight>(
    `SELECT * FROM post_insights
     WHERE connected_account_id = $1 AND engagement_rate IS NOT NULL
     ORDER BY posted_at DESC`,
    [accountId],
  );
  if (posts.length < 5) return;

  const ers = posts.map((p) => p.engagement_rate!).sort((a, b) => a - b);
  const p35 = ers[Math.floor(ers.length * 0.35)]!;
  const p65 = ers[Math.floor(ers.length * 0.65)]!;
  const p90 = ers[Math.floor(ers.length * 0.90)]!;

  for (const post of posts) {
    if (post.engagement_rate == null) continue;
    let bucket: string;
    if (post.engagement_rate >= p90) bucket = 'breakout';
    else if (post.engagement_rate >= p65) bucket = 'above_average';
    else if (post.engagement_rate >= p35) bucket = 'average';
    else bucket = 'below_average';

    if (bucket !== post.performance_bucket) {
      await db.update('post_insights', { id: post.id }, { performance_bucket: bucket });
    }
  }
}

async function updateCreatorDemographics(
  creatorId: string,
  demographics: {
    gender_age: Record<string, number>;
    cities: Record<string, number>;
    countries: Record<string, number>;
  },
): Promise<void> {
  const db = getBolticClient();

  // Parse gender from keys like "M.18-24", "F.25-34"
  let malePct = 0;
  let femalePct = 0;
  let total = 0;
  for (const [key, val] of Object.entries(demographics.gender_age)) {
    total += val;
    if (key.startsWith('M.')) malePct += val;
    else if (key.startsWith('F.')) femalePct += val;
  }
  if (total > 0) {
    malePct = Math.round((malePct / total) * 100);
    femalePct = Math.round((femalePct / total) * 100);
  }

  // Top cities
  const topCities = Object.entries(demographics.cities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([city, count]) => {
      const cityTotal = Object.values(demographics.cities).reduce((s, v) => s + v, 0);
      return { city, pct: Math.round((count / cityTotal) * 100) };
    });

  const audienceDemographics = {
    source: 'verified_oauth' as const,
    sample_size: total,
    confidence: 'high' as const,
    gender: { male_pct: malePct, female_pct: femalePct, other_pct: 100 - malePct - femalePct },
    age_bands: { '18_24': null, '25_34': null, '35_44': null, '45_64': null },
    top_cities: topCities,
    country_india_pct: demographics.countries['IN'] 
      ? Math.round((demographics.countries['IN'] / Object.values(demographics.countries).reduce((s, v) => s + v, 0)) * 100)
      : null,
    top_languages: [],
    computed_at: new Date().toISOString(),
  };

  await db.update('creators', { id: creatorId }, {
    audience_demographics: audienceDemographics,
  });
}
```

- [ ] **Step 2: Create manual sync trigger route**

```typescript
// platform/app/api/sync/trigger/route.ts

import { NextResponse } from 'next/server';
import { syncConnectedAccount } from '@/lib/sync-worker';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json() as { account_id: string };
  if (!body.account_id) {
    return NextResponse.json({ error: 'account_id required' }, { status: 400 });
  }

  try {
    const result = await syncConnectedAccount(body.account_id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add platform/lib/sync-worker.ts platform/app/api/sync/
git commit -m "feat(sync): data backfill worker — fetches all posts + private metrics from Graph API"
```

---

### Task 6: Creator Insights Service

**Files:**
- Create: `platform/lib/insights-service.ts`
- Create: `platform/app/api/insights/[creatorId]/route.ts`
- Create: `platform/app/api/insights/[creatorId]/posts/route.ts`

- [ ] **Step 1: Create insights computation service**

```typescript
// platform/lib/insights-service.ts

import { getBolticClient } from '@influencer-intel/shared/db';
import type {
  ConnectedAccount,
  CreatorInsights,
  PostInsight,
  PerformanceBucket,
  InsightConfidence,
  Creator,
} from '@influencer-intel/shared/types';

export async function computeCreatorInsights(creatorId: string): Promise<CreatorInsights | null> {
  const db = getBolticClient();

  const accounts = await db.query<ConnectedAccount>(
    `SELECT * FROM connected_accounts WHERE creator_id = $1 AND connection_status = 'active' LIMIT 1`,
    [creatorId],
  );
  if (accounts.length === 0) return null;
  const account = accounts[0]!;

  const posts = await db.query<PostInsight>(
    `SELECT * FROM post_insights
     WHERE creator_id = $1 AND engagement_rate IS NOT NULL
     ORDER BY posted_at DESC`,
    [creatorId],
  );

  if (posts.length === 0) return null;

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;
  const ninetyDaysAgo = now - 90 * 24 * 3600 * 1000;

  const posts30d = posts.filter((p) => new Date(p.posted_at).getTime() > thirtyDaysAgo);
  const posts90d = posts.filter((p) => new Date(p.posted_at).getTime() > ninetyDaysAgo);

  // Rolling engagement rates
  const rolling_er_30d = posts30d.length > 0
    ? median(posts30d.map((p) => p.engagement_rate!))
    : null;
  const rolling_er_90d = posts90d.length > 0
    ? median(posts90d.map((p) => p.engagement_rate!))
    : null;

  // Breakout rate
  const breakout_threshold = rolling_er_30d != null ? rolling_er_30d * 2.0 : null;
  const breakout_rate = breakout_threshold != null && posts90d.length > 0
    ? posts90d.filter((p) => p.engagement_rate! > breakout_threshold).length / posts90d.length
    : null;

  // Consistency (coefficient of variation)
  const ers90d = posts90d.map((p) => p.engagement_rate!);
  const mean90d = ers90d.length > 0 ? ers90d.reduce((s, v) => s + v, 0) / ers90d.length : 0;
  const std90d = ers90d.length > 1
    ? Math.sqrt(ers90d.reduce((s, v) => s + (v - mean90d) ** 2, 0) / (ers90d.length - 1))
    : 0;
  const er_coefficient_of_variation = mean90d > 0 ? std90d / mean90d : null;
  const consistency_score = er_coefficient_of_variation != null
    ? Math.max(0, 1 - er_coefficient_of_variation)
    : null;

  // Growth trajectory
  const creator = await db.findById<Creator>('creators', creatorId);
  const follower_growth_30d = null; // requires historical snapshots — Phase 2
  const follower_growth_90d = null;

  // Content cadence
  const timestamps = posts.map((p) => new Date(p.posted_at).getTime()).sort((a, b) => b - a);
  let posts_per_week: number | null = null;
  let avg_days_between_posts: number | null = null;
  if (timestamps.length >= 2) {
    const spanMs = timestamps[0]! - timestamps[timestamps.length - 1]!;
    const weeks = spanMs / (7 * 24 * 3600 * 1000);
    if (weeks > 0) posts_per_week = Math.round((timestamps.length / weeks) * 10) / 10;
    const gaps: number[] = [];
    for (let i = 0; i < timestamps.length - 1; i++) {
      gaps.push((timestamps[i]! - timestamps[i + 1]!) / (24 * 3600 * 1000));
    }
    avg_days_between_posts = Math.round((gaps.reduce((s, v) => s + v, 0) / gaps.length) * 10) / 10;
  }

  // Audience quality score
  const demographics = creator?.audience_demographics;
  let audience_quality_score: number | null = null;
  let audience_demographics_parsed = null;
  if (demographics && demographics.source === 'verified_oauth') {
    const indiaFactor = (demographics.country_india_pct ?? 0) / 100;
    const cityFactor = demographics.top_cities.length > 0 ? Math.min(1, demographics.top_cities.length / 5) : 0.5;
    audience_quality_score = Math.round((indiaFactor * 0.5 + cityFactor * 0.3 + 0.2) * 100) / 100;
    audience_demographics_parsed = {
      gender: {
        male_pct: demographics.gender.male_pct ?? 0,
        female_pct: demographics.gender.female_pct ?? 0,
      },
      top_age_band: '25_34',
      top_cities: demographics.top_cities.slice(0, 5),
      top_countries: [],
    };
  }

  // Top/worst posts
  const sortedByEr = [...posts].sort((a, b) => (b.engagement_rate ?? 0) - (a.engagement_rate ?? 0));
  const top_posts = sortedByEr.slice(0, 5).map((p) => ({
    ig_shortcode: p.ig_shortcode,
    er: p.engagement_rate!,
    bucket: (p.performance_bucket ?? 'average') as PerformanceBucket,
  }));
  const worst_posts = sortedByEr.slice(-5).reverse().map((p) => ({
    ig_shortcode: p.ig_shortcode,
    er: p.engagement_rate!,
    bucket: (p.performance_bucket ?? 'average') as PerformanceBucket,
  }));

  // Best posting hours/days
  const hourCounts = new Map<number, { count: number; totalEr: number }>();
  const dayCounts = new Map<number, { count: number; totalEr: number }>();
  for (const p of posts) {
    const d = new Date(p.posted_at);
    const hour = d.getUTCHours();
    const day = d.getUTCDay();
    const h = hourCounts.get(hour) ?? { count: 0, totalEr: 0 };
    h.count++; h.totalEr += p.engagement_rate ?? 0;
    hourCounts.set(hour, h);
    const dv = dayCounts.get(day) ?? { count: 0, totalEr: 0 };
    dv.count++; dv.totalEr += p.engagement_rate ?? 0;
    dayCounts.set(day, dv);
  }
  const best_posting_hours = [...hourCounts.entries()]
    .sort(([, a], [, b]) => (b.totalEr / b.count) - (a.totalEr / a.count))
    .slice(0, 3)
    .map(([h]) => h);
  const best_posting_days = [...dayCounts.entries()]
    .sort(([, a], [, b]) => (b.totalEr / b.count) - (a.totalEr / a.count))
    .slice(0, 3)
    .map(([d]) => d);

  // Confidence based on data volume
  let confidence: InsightConfidence = 'very_low';
  if (posts.length >= 30) confidence = 'high';
  else if (posts.length >= 15) confidence = 'medium';
  else if (posts.length >= 5) confidence = 'low';

  return {
    creator_id: creatorId,
    connected_account_id: account.id,
    rolling_er_30d,
    rolling_er_90d,
    breakout_rate,
    breakout_threshold,
    consistency_score,
    er_coefficient_of_variation,
    follower_growth_30d,
    follower_growth_90d,
    posts_per_week,
    avg_days_between_posts,
    audience_quality_score,
    audience_demographics: audience_demographics_parsed,
    top_posts,
    worst_posts,
    best_posting_hours,
    best_posting_days,
    computed_at: new Date().toISOString(),
    confidence,
  };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
```

- [ ] **Step 2: Create insights API route**

```typescript
// platform/app/api/insights/[creatorId]/route.ts

import { NextResponse } from 'next/server';
import { computeCreatorInsights } from '@/lib/insights-service';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ creatorId: string }> },
): Promise<NextResponse> {
  const { creatorId } = await params;
  
  const insights = await computeCreatorInsights(creatorId);
  if (!insights) {
    return NextResponse.json(
      { error: 'No connected account or insufficient data' },
      { status: 404 },
    );
  }
  return NextResponse.json(insights);
}
```

- [ ] **Step 3: Create posts API route**

```typescript
// platform/app/api/insights/[creatorId]/posts/route.ts

import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { PostInsight } from '@influencer-intel/shared/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ creatorId: string }> },
): Promise<NextResponse> {
  const { creatorId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const bucket = url.searchParams.get('bucket');

  const db = getBolticClient();

  let whereClause = 'WHERE creator_id = $1';
  const queryParams: unknown[] = [creatorId];

  if (bucket) {
    queryParams.push(bucket);
    whereClause += ` AND performance_bucket = $${queryParams.length}`;
  }

  const posts = await db.query<PostInsight>(
    `SELECT * FROM post_insights ${whereClause}
     ORDER BY posted_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    queryParams,
  );

  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM post_insights ${whereClause}`,
    queryParams,
  );

  return NextResponse.json({
    posts,
    total: Number(countResult[0]?.count ?? 0),
    limit,
    offset,
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add platform/lib/insights-service.ts platform/app/api/insights/
git commit -m "feat(insights): creator insights computation + API — breakout rate, rolling ER, audience quality"
```

---

### Task 7: Content Scoring via Gemini 2.5 Flash

**Files:**
- Create: `shared/content-scorer/gemini-client.ts`
- Create: `platform/app/api/score/content/route.ts`

- [ ] **Step 1: Create Gemini content scorer**

```typescript
// shared/content-scorer/gemini-client.ts

import type { ContentScores, ContentScoreRequest, ContentScoreResponse, PerformanceBucket, InsightConfidence } from '../types/growth-engine';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const SCORING_PROMPT = `You are an expert Instagram content analyst. Score this content on 12 dimensions, each from 0.0 to 1.0.

Dimensions:
1. hook_strength — How compelling is the first 1-3 seconds? Does it stop the scroll?
2. retention_design — Does the content maintain attention throughout? Pacing, pattern interrupts, curiosity gaps.
3. information_density — Value delivered per second of watch time. Educational or entertainment density.
4. emotional_trigger — Does it evoke strong emotion? Surprise, humor, inspiration, outrage, nostalgia.
5. production_quality — Lighting, framing, audio clarity, editing polish. NOT over-production.
6. trend_leverage — Does it use trending audio, formats, or cultural references?
7. brand_integration — If branded, how naturally is the product/brand woven in? (1.0 = seamless, 0.3 = forced)
8. cta_effectiveness — Does it prompt saves, shares, comments, or follows? Clear but not desperate.
9. audio_fit — Does the audio enhance the content? Music-content sync, voiceover quality.
10. shareability — Would someone DM this to a friend? Relatable, useful, or entertaining enough to share.
11. comment_magnetism — Does it provoke opinions, questions, tags? ("Tag someone who..." effect)
12. niche_authority — Does the creator demonstrate expertise or authenticity in their niche?

Respond ONLY with valid JSON in this exact format:
{
  "hook_strength": 0.0,
  "retention_design": 0.0,
  "information_density": 0.0,
  "emotional_trigger": 0.0,
  "production_quality": 0.0,
  "trend_leverage": 0.0,
  "brand_integration": 0.0,
  "cta_effectiveness": 0.0,
  "audio_fit": 0.0,
  "shareability": 0.0,
  "comment_magnetism": 0.0,
  "niche_authority": 0.0,
  "improvement_suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
}`;

const DIMENSION_WEIGHTS: Record<string, number> = {
  hook_strength: 0.15,
  retention_design: 0.12,
  information_density: 0.08,
  emotional_trigger: 0.10,
  production_quality: 0.07,
  trend_leverage: 0.10,
  brand_integration: 0.08,
  cta_effectiveness: 0.05,
  audio_fit: 0.07,
  shareability: 0.08,
  comment_magnetism: 0.05,
  niche_authority: 0.05,
};

export async function scoreContent(req: ContentScoreRequest): Promise<ContentScoreResponse> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

  // Add the media
  if (req.media_type === 'VIDEO') {
    parts.push({
      text: `${SCORING_PROMPT}\n\nContent type: ${req.media_type}\nCaption: ${req.caption ?? '(no caption)'}\nCreator category: ${req.creator_category ?? 'unknown'}\n\nAnalyze the video at this URL: ${req.media_url}`,
    });
  } else {
    // For images, fetch and inline
    const imgRes = await fetch(req.media_url);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    parts.push({
      inline_data: {
        mime_type: imgRes.headers.get('content-type') ?? 'image/jpeg',
        data: imgBuf.toString('base64'),
      },
    });
    parts.push({
      text: `${SCORING_PROMPT}\n\nContent type: ${req.media_type}\nCaption: ${req.caption ?? '(no caption)'}\nCreator category: ${req.creator_category ?? 'unknown'}`,
    });
  }

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    },
  );

  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);

  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates[0]?.content?.parts[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  const raw = JSON.parse(text) as Record<string, unknown>;

  const scores: ContentScores = {
    hook_strength: Number(raw.hook_strength ?? 0),
    retention_design: Number(raw.retention_design ?? 0),
    information_density: Number(raw.information_density ?? 0),
    emotional_trigger: Number(raw.emotional_trigger ?? 0),
    production_quality: Number(raw.production_quality ?? 0),
    trend_leverage: Number(raw.trend_leverage ?? 0),
    brand_integration: Number(raw.brand_integration ?? 0),
    cta_effectiveness: Number(raw.cta_effectiveness ?? 0),
    audio_fit: Number(raw.audio_fit ?? 0),
    shareability: Number(raw.shareability ?? 0),
    comment_magnetism: Number(raw.comment_magnetism ?? 0),
    niche_authority: Number(raw.niche_authority ?? 0),
    overall_weighted: 0,
    improvement_suggestions: (raw.improvement_suggestions as string[] | undefined) ?? [],
  };

  // Compute weighted overall score
  let weighted = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    weighted += (scores[dim as keyof ContentScores] as number) * weight;
  }
  scores.overall_weighted = Math.round(weighted * 1000) / 1000;

  // Estimate bucket from content score alone (low confidence)
  let bucket: PerformanceBucket = 'average';
  if (scores.overall_weighted >= 0.75) bucket = 'breakout';
  else if (scores.overall_weighted >= 0.55) bucket = 'above_average';
  else if (scores.overall_weighted < 0.35) bucket = 'below_average';

  return {
    scores,
    overall_bucket_estimate: bucket,
    confidence: 'low' as InsightConfidence,
  };
}
```

- [ ] **Step 2: Create content scoring API route**

```typescript
// platform/app/api/score/content/route.ts

import { NextResponse } from 'next/server';
import { scoreContent } from '@influencer-intel/shared/content-scorer/gemini-client';
import type { ContentScoreRequest } from '@influencer-intel/shared/types';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json() as ContentScoreRequest;

  if (!body.media_url || !body.media_type) {
    return NextResponse.json(
      { error: 'media_url and media_type are required' },
      { status: 400 },
    );
  }

  try {
    const result = await scoreContent(body);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[content-scorer] error:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/content-scorer/ platform/app/api/score/
git commit -m "feat(content-scorer): Gemini 2.5 Flash 12-dimension content scoring with weighted composite"
```

---

### Task 8: Insights Dashboard Page

**Files:**
- Create: `platform/app/insights/[handle]/page.tsx`
- Modify: `platform/app/creators/[handle]/page.tsx`

- [ ] **Step 1: Create insights dashboard page**

```tsx
// platform/app/insights/[handle]/page.tsx

import { getBolticClient } from '@influencer-intel/shared/db';
import type { Creator, ConnectedAccount, PostInsight, CreatorInsights } from '@influencer-intel/shared/types';
import { computeCreatorInsights } from '@/lib/insights-service';
import Link from 'next/link';

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const db = getBolticClient();

  const creators = await db.query<Creator>(
    `SELECT * FROM creators WHERE handle = $1 AND platform = 'instagram' LIMIT 1`,
    [handle],
  );
  if (creators.length === 0) {
    return <div className="p-8 text-center text-gray-400">Creator @{handle} not found</div>;
  }
  const creator = creators[0]!;

  const accounts = await db.query<ConnectedAccount>(
    `SELECT * FROM connected_accounts WHERE creator_id = $1 AND connection_status = 'active' LIMIT 1`,
    [creator.id],
  );

  if (accounts.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">@{handle}</h1>
        <p className="text-gray-400 mb-6">No connected Instagram account</p>
        <a
          href={`/api/oauth/instagram?brand_id=`}
          className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90"
        >
          Connect Instagram Account
        </a>
      </div>
    );
  }

  const account = accounts[0]!;
  const insights = await computeCreatorInsights(creator.id);

  const recentPosts = await db.query<PostInsight>(
    `SELECT * FROM post_insights WHERE creator_id = $1 ORDER BY posted_at DESC LIMIT 20`,
    [creator.id],
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        {creator.profile_photo_url && (
          <img src={creator.profile_photo_url} alt="" className="w-16 h-16 rounded-full" />
        )}
        <div>
          <h1 className="text-2xl font-bold">@{handle}</h1>
          <p className="text-gray-400">
            {creator.follower_count?.toLocaleString()} followers
            {' · '}
            {account.posts_synced_count} posts synced
            {' · '}
            Last sync: {account.last_sync_at ? new Date(account.last_sync_at).toLocaleDateString() : 'never'}
          </p>
        </div>
        <div className="ml-auto">
          <span className={`px-3 py-1 rounded-full text-sm ${
            insights?.confidence === 'high' ? 'bg-green-900 text-green-300' :
            insights?.confidence === 'medium' ? 'bg-yellow-900 text-yellow-300' :
            'bg-red-900 text-red-300'
          }`}>
            {insights?.confidence ?? 'no data'} confidence
          </span>
        </div>
      </div>

      {insights && (
        <>
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="30d Engagement Rate"
              value={insights.rolling_er_30d != null ? `${(insights.rolling_er_30d * 100).toFixed(2)}%` : '—'}
            />
            <MetricCard
              label="Breakout Rate"
              value={insights.breakout_rate != null ? `${(insights.breakout_rate * 100).toFixed(1)}%` : '—'}
            />
            <MetricCard
              label="Consistency"
              value={insights.consistency_score != null ? `${(insights.consistency_score * 100).toFixed(0)}%` : '—'}
            />
            <MetricCard
              label="Posts/Week"
              value={insights.posts_per_week?.toFixed(1) ?? '—'}
            />
          </div>

          {/* Best Posting Times */}
          <div className="bg-gray-900 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold mb-3">Optimal Posting</h2>
            <div className="flex gap-8">
              <div>
                <span className="text-gray-400 text-sm">Best hours (UTC)</span>
                <p className="text-lg">{insights.best_posting_hours.map(h => `${h}:00`).join(', ') || '—'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-sm">Best days</span>
                <p className="text-lg">{insights.best_posting_days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ') || '—'}</p>
              </div>
            </div>
          </div>

          {/* Audience Demographics */}
          {insights.audience_demographics && (
            <div className="bg-gray-900 rounded-lg p-6 mb-8">
              <h2 className="text-lg font-semibold mb-3">Audience (Verified via OAuth)</h2>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <span className="text-gray-400 text-sm">Gender Split</span>
                  <div className="flex gap-4 mt-1">
                    <span>Male: {insights.audience_demographics.gender.male_pct}%</span>
                    <span>Female: {insights.audience_demographics.gender.female_pct}%</span>
                  </div>
                </div>
                <div>
                  <span className="text-gray-400 text-sm">Top Cities</span>
                  <div className="mt-1">
                    {insights.audience_demographics.top_cities.slice(0, 5).map((c) => (
                      <span key={c.city} className="inline-block bg-gray-800 rounded px-2 py-1 mr-2 mb-1 text-sm">
                        {c.city} ({c.pct}%)
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Content Library */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Content Library ({recentPosts.length} posts)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recentPosts.map((post) => (
            <div key={post.id} className="bg-gray-900 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm text-gray-400">
                  {new Date(post.posted_at).toLocaleDateString()}
                </span>
                {post.performance_bucket && (
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    post.performance_bucket === 'breakout' ? 'bg-green-900 text-green-300' :
                    post.performance_bucket === 'above_average' ? 'bg-blue-900 text-blue-300' :
                    post.performance_bucket === 'average' ? 'bg-gray-700 text-gray-300' :
                    'bg-red-900 text-red-300'
                  }`}>
                    {post.performance_bucket.replace('_', ' ')}
                  </span>
                )}
              </div>
              {post.caption && (
                <p className="text-sm text-gray-300 mb-3 line-clamp-2">{post.caption}</p>
              )}
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <div className="text-gray-400">Likes</div>
                  <div>{post.like_count.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-gray-400">Saves</div>
                  <div>{post.saved?.toLocaleString() ?? '—'}</div>
                </div>
                <div>
                  <div className="text-gray-400">Reach</div>
                  <div>{post.reach?.toLocaleString() ?? '—'}</div>
                </div>
              </div>
              {post.engagement_rate != null && (
                <div className="mt-2 text-center text-sm font-medium">
                  ER: {(post.engagement_rate * 100).toFixed(2)}%
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Add "Connect Account" button to existing creator detail page**

In `platform/app/creators/[handle]/page.tsx`, add a link/button in the header area:

```tsx
{/* Add near the creator header section */}
<Link
  href={`/insights/${creator.handle}`}
  className="text-sm text-purple-400 hover:text-purple-300"
>
  View Insights
</Link>
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /Users/salmansaudagar/VTO/influencer-intel/platform && npx next build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add platform/app/insights/ platform/app/creators/
git commit -m "feat(ui): creator insights dashboard — metrics, audience demographics, content library"
```

---

### Task 9: Environment Setup + Wiring

**Files:**
- Modify: `.env.example` or document required env vars
- Modify: `shared/tsconfig.json` if needed

- [ ] **Step 1: Document required environment variables**

Add to `.env.example` (or create if doesn't exist):

```env
# Instagram Graph API OAuth (Content Growth Engine)
IG_APP_ID=<meta-app-id>
IG_APP_SECRET=<meta-app-secret>
IG_REDIRECT_URI=http://localhost:3000/api/oauth/instagram/callback

# Gemini API (Content Scoring)
GEMINI_API_KEY=<gemini-api-key>
```

- [ ] **Step 2: Ensure shared tsconfig supports fetch types**

Check `shared/tsconfig.json` includes `"lib": ["ES2022", "DOM"]` in compilerOptions. If not, add it.

- [ ] **Step 3: Verify shared package exports the new modules**

Check `shared/package.json` exports map includes paths for `ig-graph` and `content-scorer`. If using `"exports"` field, add:

```json
{
  "./ig-graph/client": "./ig-graph/client.ts",
  "./ig-graph/types": "./ig-graph/types.ts",
  "./content-scorer/gemini-client": "./content-scorer/gemini-client.ts"
}
```

Or if using barrel exports through types/index.ts, verify it re-exports growth-engine types.

- [ ] **Step 4: Commit**

```bash
git add .env.example shared/tsconfig.json shared/package.json
git commit -m "chore: add env vars for IG OAuth + Gemini, wire shared module exports"
```

---

### Task 10: Integration Smoke Test

- [ ] **Step 1: Run the migration against local/dev database**

```bash
cd /Users/salmansaudagar/VTO/influencer-intel
# Apply migration (adjust connection string as needed)
psql "$BOLTIC_DATABASE_URL" -f db/migrations/001-connected-accounts.sql
```

Expected: Tables `connected_accounts` and `post_insights` created successfully.

- [ ] **Step 2: Build the full monorepo**

```bash
cd /Users/salmansaudagar/VTO/influencer-intel
npm run platform:build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 3: Start dev server and verify new routes**

```bash
npm run platform:dev
```

Then verify:
- `GET /api/oauth/instagram?brand_id=test` → redirects to Instagram OAuth URL
- `GET /api/insights/nonexistent` → returns 404
- `POST /api/score/content` with `{}` → returns 400 (missing fields)
- `/insights/somehandle` → renders "No connected account" page

- [ ] **Step 4: Final commit with all changes**

```bash
git add -A
git commit -m "feat(growth-engine): Phase 1 complete — connected accounts, insights engine, content scoring

Implements:
- Instagram Graph API OAuth flow (connect/callback)
- Data sync worker (backfill all posts + private metrics)
- Creator insights computation (breakout rate, rolling ER, consistency, audience quality)
- Content scoring via Gemini 2.5 Flash (12 dimensions)
- Insights dashboard page with metrics, demographics, content library
- New DB tables: connected_accounts, post_insights
- API routes: /oauth/instagram, /insights/:id, /score/content, /sync/trigger"
```
