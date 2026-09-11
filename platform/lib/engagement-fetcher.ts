// ============================================================
// Engagement backfill via the FREE og-proxy path (NO Apify, NO web_profile_info).
//
// This is the fix for the platform's biggest data gap: ~70% of creator rows have
// no engagement (avg likes/comments, engagement rate) because the authenticated
// web_profile_info endpoint 401-throttles and its circuit breaker backs off. The
// /api/cron/enrich route already fills what it can through that throttled path,
// but it's account-gated and pauses the moment the pool is under pressure.
//
// This worker fills the SAME numbers through the cookieless, un-throttled public
// link-preview og: pages instead (lib/og-proxy.ts → fetchOgEngagement): it reads
// the profile page for followers + recent-post shortcodes, then a few of those
// post pages for likes/comments, and computes the averages + engagement rate. It
// never touches the account pool and never spends Apify credits, so it can run
// continuously without competing with live search or risking a ban.
//
// Safe by design: bounded `limit` per run, a per-request delay so we stay polite,
// and it only stamps `last_scraped_at` on a page that actually resolved — so a
// dead/private handle isn't overwritten with zeros.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { fetchOgEngagement, completenessScore } from './live-discovery';

export interface EngagementFetchReport {
  candidates: number; // rows selected as missing engagement
  attempted: number;  // handles we fetched
  resolved: number;   // og profile pages that came back
  persisted: number;  // rows written with a real engagement rate
  with_engagement: number; // of those, how many now carry a non-zero rate
  handles: string[];  // handles we wrote (for spot-checking)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// A creator "needs engagement" if it has no usable engagement rate yet AND we
// haven't tried it recently (so a handle that resolved but had no public
// engagement isn't re-fetched every run). Scoped to active IG rows with a handle.
const NEEDS_ENGAGEMENT = `(
  (engagement_rate IS NULL OR engagement_rate = 0 OR avg_likes IS NULL)
  AND (last_scraped_at IS NULL OR last_scraped_at < now() - interval '3 days')
)`;

// How many creators currently need engagement (for an admin pre-check / the route
// response). Read-only.
export async function engagementCandidateCount(): Promise<number> {
  const rows = await getBolticClient().query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM creators
      WHERE is_active = true AND platform = 'instagram' AND handle IS NOT NULL
        AND ${NEEDS_ENGAGEMENT}`,
  );
  return Number(rows[0]?.n) || 0;
}

// Persist one free-path engagement pull back onto its creator row. Every write is
// COALESCE-guarded so a partial/blank og read never wipes existing good data:
//  - follower_count only overwritten when og returned a real (>0) count,
//  - engagement_rate/avg_likes/avg_comments only set when we actually measured
//    posts (posts_analyzed > 0), else the existing values are kept,
//  - recent_posts only replaced when we captured at least one post.
// engagement_rate is stored as a FRACTION ((likes+comments)/followers) to match
// the convention used everywhere else (instagram-scraper, /api/cron/enrich).
async function persist(
  handle: string,
  og: Awaited<ReturnType<typeof fetchOgEngagement>>,
): Promise<boolean> {
  if (!og) return false;
  const db = getBolticClient();
  const measured = og.posts_analyzed > 0;
  const rate = measured && og.followers > 0
    ? (og.avg_likes + og.avg_comments) / og.followers
    : null;
  const score = completenessScore({
    full_name: og.full_name ?? undefined,
    biography: og.biography ?? undefined,
    category: og.category ?? undefined,
    profile_pic_url: og.profile_pic_url,
    followers: og.followers,
    engagement: og.engagement_rate, // percent form, only used for scoring
  });
  const posts = og.recent_posts.length > 0 ? JSON.stringify(og.recent_posts) : null;
  try {
    await db.query(
      `UPDATE creators SET
         display_name      = COALESCE(NULLIF($2, ''), display_name),
         bio               = COALESCE(NULLIF($3, ''), bio),
         primary_category  = COALESCE(NULLIF($4, ''), primary_category),
         profile_photo_url = COALESCE($5, profile_photo_url),
         follower_count    = COALESCE(NULLIF($6, 0), follower_count),
         engagement_rate   = COALESCE($7, engagement_rate),
         avg_likes         = COALESCE($8, avg_likes),
         avg_comments      = COALESCE($9, avg_comments),
         recent_posts      = COALESCE($10::json, recent_posts),
         data_completeness = GREATEST(COALESCE(data_completeness, 0), $11),
         last_scraped_at   = now()
       WHERE platform = 'instagram' AND lower(handle) = lower($1)`,
      [
        handle,
        og.full_name ?? '',
        og.biography ?? '',
        og.category ?? '',
        og.profile_pic_url,
        og.followers,
        rate,
        measured ? og.avg_likes : null,
        measured ? og.avg_comments : null,
        posts,
        score,
      ],
    );
    return true;
  } catch {
    return false;
  }
}

// Backfill engagement for up to `limit` creators that are missing it, via the
// free og path. Biggest creators first, so the most valuable/searched rows fill
// in even if a run is cut short. `delayMs` paces requests to stay polite. Returns
// a report; never throws on a single failure.
export async function backfillEngagement(
  opts: { limit?: number; delayMs?: number } = {},
): Promise<EngagementFetchReport> {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
  const delayMs = Math.max(0, Math.min(opts.delayMs ?? 800, 5_000));
  const db = getBolticClient();

  const rows = await db.query<{ handle: string }>(
    `SELECT handle FROM creators
      WHERE is_active = true AND platform = 'instagram' AND handle IS NOT NULL
        AND ${NEEDS_ENGAGEMENT}
      ORDER BY follower_count DESC NULLS LAST
      LIMIT ${limit}`,
  );
  const handles = rows.map((r) => r.handle).filter(Boolean);

  let resolved = 0;
  let persisted = 0;
  let withEngagement = 0;
  const done: string[] = [];

  for (const handle of handles) {
    const og = await fetchOgEngagement(handle).catch(() => null);
    if (og) {
      resolved += 1;
      if (await persist(handle, og)) {
        persisted += 1;
        if (og.posts_analyzed > 0 && og.followers > 0) withEngagement += 1;
        done.push(handle);
      }
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  return {
    candidates: handles.length,
    attempted: handles.length,
    resolved,
    persisted,
    with_engagement: withEngagement,
    handles: done,
  };
}
