import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph';
import { getAccessToken } from '@/lib/oauth-service';
import { resolveCreatorId } from '@/lib/creator-identity';
import type { ConnectedAccount } from '@influencer-intel/shared/types';
import type { IGMedia } from '@influencer-intel/shared/ig-graph/types';
import type { DemographicsInput } from '@/lib/audience-insights';
import {
  assembleCreatorAnalytics,
  loadPeerCohorts,
  INSIGHTS_CAP,
  type AnalyticsPost,
  type PeerCohorts,
} from '@/lib/analytics-assembler';

export const runtime = 'nodejs';
export const maxDuration = 60;

// How many recent posts to enrich with per-media insights (reach/plays/saves)
// on a live pull. Bounded so we stay inside the Graph rate budget.
const MEDIA_CAP = 24;

/**
 * GET /api/creator/analytics?account=<id>|?handle=<h>
 *
 * Measures ANY creator's Instagram analytics, via one of two paths that emit
 * the SAME dashboard payload:
 *   • LIVE — if the creator has an active connected account, we pull fresh from
 *     the Graph API (posts enriched with reach/plays/saves/shares).
 *   • DB   — otherwise (or if the live pull fails: expired token, missing
 *     insights permission), we measure from the STORED `creators` row
 *     (recent_posts + audience_demographics + credibility + follower/ER stats).
 *
 * Always 200 — `connected:false` carries a friendly reason so the preview page
 * can render an empty state. The two paths mean the analytics page works for
 * scraped/seeded creators too, not just OAuth-connected ones.
 *
 * Powers the creator portal's "My Analytics" page (/creator/analytics-preview),
 * reachable from the dashboard and shareable read-only via ?handle/?account.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const db = getBolticClient();

  // Session-first identity: resolve the creator, then load THEIR active
  // connected account (the ?handle/?account preview fallbacks live in the resolver).
  let creatorId: string | null = null;
  let account: ConnectedAccount | null = null;
  try {
    creatorId = await resolveCreatorId(request);
    if (!creatorId) {
      return NextResponse.json({ connected: false, reason: 'no_creator' }, { status: 200 });
    }
    const rows = await db.query<ConnectedAccount>(
      `SELECT * FROM connected_accounts
       WHERE creator_id = $1 AND connection_status = 'active'
       ORDER BY connected_at DESC LIMIT 1`, [creatorId],
    );
    account = rows[0] ?? null;
  } catch (err) {
    return NextResponse.json(
      { connected: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }

  // ---- Live path first (fresh Graph pull) --------------------------------
  // If the token is stale or insights aren't granted, fall through to the
  // stored-data path so the creator still sees real analytics.
  if (account) {
    try {
      return await buildLive(db, account);
    } catch {
      // fall through to the DB fallback below
    }
  }

  // ---- DB fallback (measure from the stored creators row) ----------------
  try {
    const payload = await buildDbAnalytics(db, creatorId);
    if (payload) return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { connected: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }

  // No connected account and no usable stored data to measure.
  return NextResponse.json(
    { connected: false, reason: account ? 'fetch_error' : 'no_account' },
    { status: 200 },
  );
}

// ============================================================
// LIVE — fresh Instagram Graph pull
// ============================================================

async function buildLive(
  db: ReturnType<typeof getBolticClient>,
  account: ConnectedAccount,
): Promise<NextResponse> {
  const token = await getAccessToken(account.id);
  const client = new IGGraphClient(token);

  const profile = await client.getProfile();
  const followers = profile.followers_count ?? 0;

  // Record today's follower snapshot (one row per account per day) so the
  // dashboard can chart growth over time. Best-effort — never blocks the
  // response. IG only gives us the current count, so history accrues here.
  let growth: { date: string; followers: number }[] = [];
  try {
    await db.query(
      `INSERT INTO follower_snapshots
         (connected_account_id, creator_id, followers_count, follows_count, media_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (connected_account_id, captured_on) DO UPDATE SET
         followers_count = EXCLUDED.followers_count,
         follows_count   = EXCLUDED.follows_count,
         media_count     = EXCLUDED.media_count,
         captured_at     = NOW()`,
      [account.id, account.creator_id, profile.followers_count ?? null,
        profile.follows_count ?? null, profile.media_count ?? null],
    );
    const snaps = await db.query<{ captured_on: string; followers_count: number | string }>(
      `SELECT captured_on, followers_count FROM follower_snapshots
       WHERE connected_account_id = $1 AND followers_count IS NOT NULL
       ORDER BY captured_on ASC LIMIT 90`,
      [account.id],
    );
    growth = snaps.map((s) => ({
      date: typeof s.captured_on === 'string' ? s.captured_on.slice(0, 10)
        : new Date(s.captured_on).toISOString().slice(0, 10),
      followers: Number(s.followers_count),
    }));
  } catch {
    growth = [];
  }

  const media: IGMedia[] = await client.getAllMedia(MEDIA_CAP);

  // Enrich the most recent posts with per-media insights (reach/plays/etc).
  const toEnrich = media.slice(0, INSIGHTS_CAP);
  const insightsResults = await Promise.allSettled(
    toEnrich.map((m) => client.getMediaInsights(m.id, m.media_type)),
  );
  const insightsById = new Map<string, Record<string, number>>();
  toEnrich.forEach((m, i) => {
    const r = insightsResults[i];
    if (r && r.status === 'fulfilled') {
      const map: Record<string, number> = {};
      for (const item of r.value.data) map[item.name] = item.values[0]?.value ?? 0;
      insightsById.set(m.id, map);
    }
  });

  const posts: AnalyticsPost[] = media.map((m) => {
    const ins = insightsById.get(m.id);
    const likes = m.like_count ?? ins?.likes ?? 0;
    const comments = m.comments_count ?? ins?.comments ?? 0;
    const er = followers > 0 ? (likes + comments) / followers : null;
    return {
      id: m.id,
      shortcode: m.shortcode,
      permalink: m.permalink,
      media_type: m.media_type,
      thumbnail_url: m.thumbnail_url ?? null,
      media_url: m.media_url ?? null,
      caption: m.caption ?? null,
      timestamp: m.timestamp,
      like_count: likes,
      comments_count: comments,
      er,
      reach: ins?.reach ?? null,
      plays: ins?.plays ?? null,
      saved: ins?.saved ?? null,
      shares: ins?.shares ?? null,
    };
  });

  // Audience demographics (best-effort — needs the insights permission).
  let demographics: DemographicsInput | null = null;
  try {
    demographics = await client.getAudienceDemographics();
  } catch {
    demographics = null;
  }

  // Peer-benchmark cohorts + the creator's own niche (best-effort).
  let cohorts: PeerCohorts = { niche_label: null, tier_ers: [], niche_ers: [] };
  try {
    cohorts = await loadPeerCohorts(db, account.creator_id, followers);
  } catch {
    cohorts = { niche_label: null, tier_ers: [], niche_ers: [] };
  }

  const body = assembleCreatorAnalytics({
    followers,
    media_count: profile.media_count ?? null,
    niche: cohorts.niche_label,
    posts,
    growth,
    demographics,
    profile: {
      name: profile.name ?? null,
      username: profile.username ?? null,
      biography: profile.biography ?? null,
      website: profile.website ?? null,
    },
    cohorts,
  });

  return NextResponse.json({
    connected: true,
    source: 'live',
    account: {
      id: account.id,
      ig_username: account.ig_username,
      connected_at: account.connected_at,
      token_expires_at: account.token_expires_at,
      connection_status: account.connection_status,
    },
    profile: {
      username: profile.username,
      name: profile.name ?? null,
      biography: profile.biography ?? null,
      followers_count: profile.followers_count ?? null,
      follows_count: profile.follows_count ?? null,
      media_count: profile.media_count ?? null,
      profile_picture_url: profile.profile_picture_url ?? null,
      website: profile.website ?? null,
    },
    ...body,
  });
}

// ============================================================
// DB — measure from the stored `creators` row
// ============================================================

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Loose stored shapes — JSONB columns are best-effort across scraper versions.
interface DbRecentPost {
  platform_post_id?: string;
  post_url?: string;
  post_type?: string | null;
  caption?: string | null;
  posted_at?: string | null;
  view_count?: number | string | null;
  like_count?: number | string | null;
  comment_count?: number | string | null;
  thumbnail_url?: string | null;
  media_url?: string | null;
}
interface DbDemographics {
  gender?: { male_pct?: number | string | null; female_pct?: number | string | null; other_pct?: number | string | null };
  age_bands?: Record<string, number | string | null>;
  top_cities?: { city?: string; pct?: number | string }[];
  country_india_pct?: number | string | null;
}
interface DbCredibility { overall_score?: number | string; badge?: string }
interface CreatorRow {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  profile_photo_url: string | null;
  is_verified: boolean | null;
  primary_category: string | null;
  primary_city: string | null;
  follower_count: number | string | null;
  following_count: number | string | null;
  posts_count: number | string | null;
  avg_likes: number | string | null;
  avg_views: number | string | null;
  engagement_rate: number | string | null;
  recent_posts: DbRecentPost[] | null;
  audience_demographics: DbDemographics | null;
  credibility: DbCredibility | null;
}

const DB_SELECT = `SELECT id, handle, display_name, bio, profile_photo_url, is_verified,
                          primary_category, primary_city, follower_count, following_count,
                          posts_count, avg_likes, avg_views, engagement_rate,
                          recent_posts, audience_demographics, credibility
                   FROM creators`;

const REEL_TYPES = new Set(['reel', 'reels', 'video']);
function mediaTypeFor(t: string | null | undefined): string {
  const s = (t ?? '').toLowerCase();
  if (REEL_TYPES.has(s)) return 'REELS';
  if (s === 'carousel' || s === 'carousel_album') return 'CAROUSEL_ALBUM';
  return 'IMAGE';
}

// How many synced posts to feed the analytics assembler from post_insights.
// They're already stored, so this is cheap — bound only to keep the payload sane.
const SYNCED_POST_CAP = 60;

// Stored row from the sync worker's post_insights table. This is the RICH
// source (real reach/plays/saved/shares/ER per post) — far better than the
// sparse recent_posts JSONB, and it's what the live Graph pull persists.
interface SyncedPostRow {
  ig_media_id: string;
  ig_shortcode: string | null;
  permalink: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  caption: string | null;
  posted_at: string | null;
  like_count: number | string | null;
  comment_count: number | string | null;
  reach: number | string | null;
  plays: number | string | null;
  saved: number | string | null;
  shares: number | string | null;
  engagement_rate: number | string | null;
}

/**
 * Load the creator's synced posts straight from post_insights (populated by the
 * sync worker on connect + every re-sync). These carry real per-post
 * reach/plays/saved/shares/ER, so the reel-performance, reach and content
 * sections light up even when the LIVE Graph pull is unavailable (expired
 * token, rate limit). Returns [] when nothing has been synced yet.
 */
async function loadSyncedPosts(
  db: ReturnType<typeof getBolticClient>,
  creatorId: string,
  followers: number,
  handle: string,
): Promise<AnalyticsPost[]> {
  const rows = await db.query<SyncedPostRow>(
    `SELECT ig_media_id, ig_shortcode, permalink, media_type, thumbnail_url,
            media_url, caption, posted_at::text AS posted_at,
            like_count, comment_count, reach, plays, saved, shares, engagement_rate
     FROM post_insights
     WHERE creator_id = $1
     ORDER BY posted_at DESC NULLS LAST
     LIMIT $2`,
    [creatorId, SYNCED_POST_CAP],
  );
  return rows.map((p): AnalyticsPost => {
    const likes = num(p.like_count);
    const comments = num(p.comment_count);
    const storedEr = numOrNull(p.engagement_rate);
    const er = storedEr ?? (followers > 0 ? (likes + comments) / followers : null);
    return {
      id: p.ig_media_id,
      shortcode: p.ig_shortcode ?? '',
      permalink: p.permalink ?? `https://instagram.com/${handle}`,
      media_type: (p.media_type ?? 'IMAGE').toUpperCase(),
      thumbnail_url: p.thumbnail_url ?? null,
      media_url: p.media_url ?? null,
      caption: p.caption ?? null,
      timestamp: p.posted_at ?? '',
      like_count: likes,
      comments_count: comments,
      er,
      reach: numOrNull(p.reach),
      plays: numOrNull(p.plays),
      saved: numOrNull(p.saved),
      shares: numOrNull(p.shares),
    };
  });
}

// Map stored age-band keys → the "18-24" form analyzeAudience() parses.
const AGE_LABELS: Record<string, string> = {
  '18_24': '18-24', '25_34': '25-34', '35_44': '35-44', '45_64': '45-64', '65_plus': '65+',
};

/**
 * Reshape our stored `audience_demographics` (gender + age_bands stored
 * SEPARATELY, not cross-tabbed) into the gender×age blob analyzeAudience()
 * expects. We approximate the cross-tab by splitting each age band by the
 * overall gender ratio — enough to surface skew, dominant segment and top age.
 */
function reshapeDbDemographics(demo: DbDemographics | null): DemographicsInput | null {
  if (!demo) return null;

  const female = num(demo.gender?.female_pct);
  const male = num(demo.gender?.male_pct);
  const gTotal = female + male;

  const gender_age: Record<string, number> = {};
  for (const [key, label] of Object.entries(AGE_LABELS)) {
    const v = num(demo.age_bands?.[key]);
    if (v <= 0) continue;
    if (gTotal > 0) {
      gender_age[`F ${label}`] = v * (female / gTotal);
      gender_age[`M ${label}`] = v * (male / gTotal);
    } else {
      gender_age[label] = v;
    }
  }

  const cities: Record<string, number> = {};
  for (const c of demo.top_cities ?? []) {
    if (c?.city) cities[c.city] = num(c.pct);
  }

  const countries: Record<string, number> = {};
  const indiaPct = num(demo.country_india_pct);
  if (indiaPct > 0) {
    countries['India'] = indiaPct;
    if (indiaPct < 100) countries['Other'] = 100 - indiaPct;
  }

  const has = Object.keys(gender_age).length > 0 || Object.keys(cities).length > 0;
  return has ? { gender_age, cities, countries } : null;
}

/**
 * Build the analytics payload for a creator from their stored DB row. Returns
 * null when there's no row or nothing measurable (no followers), so the caller
 * can emit a friendly `connected:false`.
 */
async function buildDbAnalytics(
  db: ReturnType<typeof getBolticClient>,
  creatorId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db.query<CreatorRow>(`${DB_SELECT} WHERE id = $1 LIMIT 1`, [creatorId]);
  const row = rows[0] ?? null;
  if (!row) return null;

  const followers = num(row.follower_count);
  if (followers <= 0) return null; // nothing measurable without an audience size

  // Prefer the RICH synced posts (post_insights) — they carry real per-post
  // reach/plays/saved/shares/ER from the sync worker, so the reel/reach/content
  // sections stay live even when the Graph pull is down. Fall back to the sparse
  // recent_posts JSONB (no reach/saves/shares) only when nothing's been synced.
  let posts: AnalyticsPost[] = [];
  let postsSource: 'synced' | 'stored' = 'stored';
  try {
    const synced = await loadSyncedPosts(db, creatorId, followers, row.handle);
    if (synced.length > 0) {
      posts = synced.filter((p) => p.like_count > 0 || p.comments_count > 0 || p.plays != null || p.reach != null);
      if (posts.length > 0) postsSource = 'synced';
    }
  } catch {
    posts = [];
  }

  // Normalise stored recent_posts → the shared AnalyticsPost shape. ER is
  // derived the same way as the live path ((likes+comments)/followers). We have
  // no per-post reach/saves/shares stored, so those stay null (the sections
  // that need them degrade gracefully). `plays` comes from view_count.
  if (posts.length === 0) {
    posts = (row.recent_posts ?? [])
      .map((p, i): AnalyticsPost => {
        const likes = num(p.like_count);
        const comments = num(p.comment_count);
        const plays = numOrNull(p.view_count);
        const er = followers > 0 ? (likes + comments) / followers : null;
        return {
          id: p.platform_post_id ?? `db-${i}`,
          shortcode: '',
          permalink: p.post_url ?? `https://instagram.com/${row.handle}`,
          media_type: mediaTypeFor(p.post_type),
          thumbnail_url: p.thumbnail_url ?? null,
          media_url: p.media_url ?? null,
          caption: p.caption ?? null,
          timestamp: p.posted_at ?? '',
          like_count: likes,
          comments_count: comments,
          er,
          reach: null,
          plays,
          saved: null,
          shares: null,
        };
      })
      .filter((p) => p.like_count > 0 || p.comments_count > 0 || p.plays != null);
  }

  const demographics = reshapeDbDemographics(row.audience_demographics);

  // Peer-benchmark cohorts + niche (best-effort).
  let cohorts: PeerCohorts = { niche_label: null, tier_ers: [], niche_ers: [] };
  try {
    cohorts = await loadPeerCohorts(db, creatorId, followers);
  } catch {
    cohorts = { niche_label: null, tier_ers: [], niche_ers: [] };
  }
  // Prefer the row's own category as the niche label when the cohort loader
  // couldn't derive one.
  const niche = cohorts.niche_label ?? (row.primary_category?.trim().toLowerCase() || null);

  // Follower-growth history — accrues from the daily snapshots the live path
  // records. A connected creator whose live pull just failed still has these,
  // so the growth chart keeps working on the fallback path. Best-effort.
  let growth: { date: string; followers: number }[] = [];
  try {
    const snaps = await db.query<{ captured_on: string; followers_count: number | string }>(
      `SELECT captured_on::text AS captured_on, followers_count FROM follower_snapshots
       WHERE creator_id = $1 AND followers_count IS NOT NULL
       ORDER BY captured_on ASC LIMIT 90`,
      [creatorId],
    );
    growth = snaps.map((s) => ({ date: s.captured_on.slice(0, 10), followers: Number(s.followers_count) }));
  } catch {
    growth = [];
  }

  const body = assembleCreatorAnalytics({
    followers,
    media_count: numOrNull(row.posts_count),
    niche,
    posts,
    growth,
    demographics,
    profile: {
      name: row.display_name,
      username: row.handle,
      biography: row.bio,
      website: null,
    },
    cohorts,
    // Stored aggregates keep benchmark/media-value/pitch working even when
    // recent_posts are sparse or missing.
    fallback: {
      avg_er: numOrNull(row.engagement_rate),
      avg_likes: numOrNull(row.avg_likes),
      avg_reel_plays: numOrNull(row.avg_views),
    },
  });

  return {
    connected: true,
    // 'synced' when built from freshly-synced post_insights (rich reach/plays),
    // 'db' when we fell back to the sparse stored recent_posts.
    source: postsSource === 'synced' ? 'synced' : 'db',
    posts_source: postsSource,
    account: null,
    profile: {
      username: row.handle,
      name: row.display_name,
      biography: row.bio,
      followers_count: followers,
      follows_count: numOrNull(row.following_count),
      media_count: numOrNull(row.posts_count),
      profile_picture_url: row.profile_photo_url,
      website: null,
    },
    ...body,
  };
}
