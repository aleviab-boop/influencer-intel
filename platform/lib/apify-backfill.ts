// ============================================================
// Bulk enrichment via Apify (PAID). Fills the creators that discovery inserted
// as thin shells — no follower_count, no recent_posts, no post thumbnails — by
// running them through the cheap unified Apify actor in batches (one billed run
// per batch, not per creator). This is the throughput path that raises coverage
// of reach/engagement + post thumbnails, which in turn feeds the visual-motif
// trends and demographic vision inference.
//
// Safe by design: does nothing without APIFY_TOKEN, and every run is bounded by
// an explicit `limit` so the bill is predictable (~$0.50 / 1k profiles).
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { apifyProfilesBatch } from './apify';
import type { ScrapedProfile } from './instagram-scraper';

export interface BackfillReport {
  candidates: number; // rows selected as needing enrichment
  attempted: number;  // handles sent to Apify
  enriched: number;   // profiles Apify returned
  persisted: number;  // rows successfully written back
  with_posts: number; // of those, how many now carry ≥1 recent post
  handles: string[];  // enriched handles (for spot-checking)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// SQL fragment: a creator "needs backfill" if it has no usable recent_posts OR no
// follower count. The CASE guards json_array_length against non-array values.
const NEEDS_BACKFILL = `(
  recent_posts IS NULL
  OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(recent_posts::jsonb) = 'array' THEN recent_posts::jsonb ELSE '[]'::jsonb END), 0) = 0
  OR follower_count IS NULL OR follower_count = 0
)`;

// How many creators currently need enrichment (for the admin UI / a pre-check).
export async function backfillCandidateCount(): Promise<number> {
  const rows = await getBolticClient().query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM creators
      WHERE is_active = true AND platform = 'instagram' AND handle IS NOT NULL
        AND ${NEEDS_BACKFILL}`,
  );
  return Number(rows[0]?.n) || 0;
}

// Persist one Apify profile back onto its creator row. Merges the post-geo blob
// into raw_metadata (|| ) rather than overwriting, so any existing vision/geo
// data used for demographics survives the enrichment.
async function persist(handle: string, sp: ScrapedProfile): Promise<boolean> {
  const db = getBolticClient();
  const geoPosts = sp.recent_posts.map((p) => ({
    code: p.platform_post_id,
    thumbnail: p.thumbnail_url,
    likes: p.like_count,
    comments: p.comment_count,
    media_type: p.post_type === 'video' ? 'video' : 'image',
    timestamp: p.posted_at,
    caption_excerpt: (p.caption ?? '').slice(0, 200),
  }));
  try {
    await db.query(
      `UPDATE creators SET
         display_name      = COALESCE(NULLIF($2, ''), display_name),
         bio               = COALESCE(NULLIF($3, ''), bio),
         follower_count    = $4,
         following_count   = $5,
         posts_count       = $6,
         is_verified       = $7,
         profile_photo_url = COALESCE($8, profile_photo_url),
         engagement_rate   = $9,
         avg_likes         = $10,
         avg_comments      = $11,
         recent_posts      = $12::json,
         raw_metadata      = COALESCE(raw_metadata, '{}'::jsonb) || $13::jsonb,
         last_scraped_at   = now()
       WHERE platform = 'instagram' AND lower(handle) = lower($1)`,
      [
        handle,
        sp.display_name ?? '',
        sp.biography ?? '',
        sp.follower_count,
        sp.following_count,
        sp.posts_count,
        sp.is_verified,
        sp.profile_photo_url,
        sp.engagement_rate,
        sp.avg_likes,
        sp.avg_comments,
        JSON.stringify(sp.recent_posts),
        JSON.stringify({ geo: { posts: geoPosts } }),
      ],
    );
    return true;
  } catch {
    return false;
  }
}

// Enrich up to `limit` under-populated creators in batches of `batchSize` (one
// Apify run each). Biggest creators first, so the most valuable rows fill in even
// if a run is cut short. Returns a report; never throws on a single failure.
export async function backfillViaApify(
  opts: { limit?: number; batchSize?: number } = {},
): Promise<BackfillReport> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 300));
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 20, 40));
  const db = getBolticClient();

  const rows = await db.query<{ handle: string }>(
    `SELECT handle FROM creators
      WHERE is_active = true AND platform = 'instagram' AND handle IS NOT NULL
        AND ${NEEDS_BACKFILL}
      ORDER BY follower_count DESC NULLS LAST
      LIMIT ${limit}`,
  );
  const handles = rows.map((r) => r.handle).filter(Boolean);

  let enriched = 0;
  let persisted = 0;
  let withPosts = 0;
  const done: string[] = [];

  for (const batch of chunk(handles, batchSize)) {
    const map = await apifyProfilesBatch(batch);
    for (const [h, sp] of map) {
      enriched += 1;
      if (await persist(h, sp)) {
        persisted += 1;
        if (sp.recent_posts.length > 0) withPosts += 1;
        done.push(h);
      }
    }
  }

  return {
    candidates: handles.length,
    attempted: handles.length,
    enriched,
    persisted,
    with_posts: withPosts,
    handles: done,
  };
}
