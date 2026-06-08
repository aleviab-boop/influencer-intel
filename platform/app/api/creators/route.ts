import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

const STALE_DAYS = 14;

const ALLOWED_SORT: Record<string, string> = {
  followers: 'follower_count DESC NULLS LAST',
  recent: 'last_scraped_at DESC NULLS LAST',
  credibility: "(credibility->>'overall_score')::int DESC NULLS LAST",
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const category = url.searchParams.get('category');
  const location = (url.searchParams.get('location') ?? '').trim().toLowerCase();
  const tier = url.searchParams.get('tier'); // mega/macro/micro/nano
  const verified = url.searchParams.get('verified');
  const sort = ALLOWED_SORT[url.searchParams.get('sort') ?? 'followers'] ?? ALLOWED_SORT.followers;
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit') ?? 30)));

  const where: string[] = ['is_active = true'];
  const params: unknown[] = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(`(LOWER(handle) LIKE $${params.length} OR LOWER(display_name) LIKE $${params.length})`);
  }
  if (location) {
    params.push(`%${location}%`);
    const li = params.length;
    where.push(`(LOWER(primary_city) LIKE $${li} OR LOWER(primary_state) LIKE $${li} OR LOWER(bio) LIKE $${li})`);
  }
  if (category) {
    params.push(`%${category.toLowerCase()}%`);
    const ci = params.length;
    where.push(`(LOWER(primary_category) LIKE $${ci} OR LOWER(raw_metadata->'vision'->>'niche') LIKE $${ci})`);
  }
  if (tier) {
    if (tier === 'mega') where.push(`follower_count >= 1000000`);
    else if (tier === 'macro') where.push(`follower_count >= 100000 AND follower_count < 1000000`);
    else if (tier === 'micro') where.push(`follower_count >= 10000 AND follower_count < 100000`);
    else if (tier === 'nano') where.push(`follower_count >= 5000 AND follower_count < 10000`);
  }
  if (verified === '1') where.push(`is_verified = true`);

  const db = getBolticClient();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, handle, display_name, profile_photo_url, follower_count,
            following_count, posts_count, primary_category, primary_city, primary_state,
            content_languages, is_verified, is_indian, bio,
            engagement_rate, avg_likes, avg_comments, avg_views,
            credibility->>'overall_score' AS cred_score,
            credibility->>'badge' AS cred_badge,
            raw_metadata->'vision'->>'niche' AS vision_niche,
            raw_metadata->'vision'->'vibe_tags' AS vibe_tags,
            last_scraped_at
     FROM creators
     WHERE ${where.join(' AND ')}
     ORDER BY ${sort}
     LIMIT ${limit}`,
    params,
  );

  const total = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM creators WHERE is_active = true`,
  );

  // On-demand refresh: queue scrapes for stale creators in results (fire-and-forget)
  enqueueStaleRefreshes(db, rows).catch(() => {});

  return NextResponse.json({ creators: rows, total: total[0]?.count ?? 0 });
}

// POST /api/creators — manually add a creator profile to the database.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const handle = typeof body?.handle === 'string' ? body.handle.trim().replace(/^@/, '') : '';
  if (handle.length < 2) return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  const platform = body?.platform === 'youtube' ? 'youtube' : 'instagram';

  const numOrNull = (v: unknown): number | null => {
    const x = Number(v);
    return Number.isFinite(x) && v !== '' && v != null ? x : null;
  };

  try {
    const db = getBolticClient();
    const dup = await db.query<{ id: string }>(
      `SELECT id FROM creators WHERE platform = $1 AND LOWER(handle) = LOWER($2) LIMIT 1`,
      [platform, handle],
    );
    if (dup.length > 0) return NextResponse.json({ error: `@${handle} is already in the database` }, { status: 409 });

    const followers = numOrNull(body.follower_count);
    const avgLikes = numOrNull(body.avg_likes);
    const avgComments = numOrNull(body.avg_comments);
    const engagement_rate = followers && followers > 0 && (avgLikes != null || avgComments != null)
      ? ((avgLikes ?? 0) + (avgComments ?? 0)) / followers
      : null;

    const profile_url = platform === 'youtube'
      ? `https://www.youtube.com/@${handle}`
      : `https://www.instagram.com/${handle}/`;

    const creator = await db.insert<Record<string, unknown>>('creators', {
      platform,
      handle,
      profile_url,
      display_name: typeof body.display_name === 'string' && body.display_name.trim() ? body.display_name.trim() : null,
      bio: typeof body.bio === 'string' && body.bio.trim() ? body.bio.trim() : null,
      profile_photo_url: typeof body.profile_photo_url === 'string' && body.profile_photo_url.trim() ? body.profile_photo_url.trim() : null,
      primary_category: typeof body.primary_category === 'string' && body.primary_category.trim() ? body.primary_category.trim() : null,
      primary_city: typeof body.primary_city === 'string' && body.primary_city.trim() ? body.primary_city.trim() : null,
      follower_count: followers,
      following_count: numOrNull(body.following_count),
      posts_count: numOrNull(body.posts_count),
      avg_likes: avgLikes,
      avg_comments: avgComments,
      engagement_rate,
      is_active: true,
      is_indian: true,
      data_tier: 'tier_a',
      source: 'manual',
    });
    return NextResponse.json({ creator });
  } catch (err) {
    console.error('[creators] create failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function enqueueStaleRefreshes(
  db: ReturnType<typeof getBolticClient>,
  creators: Record<string, unknown>[],
) {
  const staleHandles = creators
    .filter((c) => {
      if (!c.last_scraped_at) return true;
      const age = Date.now() - new Date(c.last_scraped_at as string).getTime();
      return age > STALE_DAYS * 24 * 60 * 60 * 1000;
    })
    .map((c) => c.handle as string)
    .slice(0, 20);

  if (staleHandles.length === 0) return;

  for (const handle of staleHandles) {
    const dup = await db.query<{ id: string }>(
      `SELECT id FROM scrape_jobs
       WHERE target_handle = $1 AND status IN ('queued','in_progress')
       LIMIT 1`,
      [handle],
    );
    if (dup.length > 0) continue;
    await db.insert('scrape_jobs', {
      job_type: 'refresh',
      target_platform: 'instagram',
      target_handle: handle,
      priority: 3,
      status: 'queued',
      attempts: 0,
      queued_at: new Date().toISOString(),
    });
  }
}
