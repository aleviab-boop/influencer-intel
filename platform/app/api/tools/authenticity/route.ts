import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { scoreAuthenticity } from '@/lib/authenticity';

export const runtime = 'nodejs';

// GET /api/tools/authenticity?handle=foo
// Loads the creator (incl. recent_posts) and returns a 0–100 authenticity score
// with its signal breakdown. Per-post analysis when posts exist, else averages.
export async function GET(req: NextRequest) {
  const handle = (new URL(req.url).searchParams.get('handle') ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });

  try {
    const db = getBolticClient();
    const rows = await db.query<Record<string, unknown>>(
      `SELECT handle, display_name, follower_count, following_count, avg_likes, avg_comments,
              engagement_rate, recent_posts,
              credibility->>'overall_score' AS cred_score
       FROM creators
       WHERE LOWER(handle) = $1 AND is_active = true
       LIMIT 1`,
      [handle],
    );
    const c = rows[0];
    if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const result = scoreAuthenticity({
      follower_count: c.follower_count as number | null,
      following_count: c.following_count as number | null,
      avg_likes: c.avg_likes as number | null,
      avg_comments: c.avg_comments as number | null,
      engagement_rate: c.engagement_rate as number | null,
      cred_score: c.cred_score as string | null,
      recent_posts: (c.recent_posts as []) ?? [],
    });

    const followers = Number(c.follower_count) || 0;
    return NextResponse.json({
      handle: c.handle,
      display_name: c.display_name,
      followers,
      ...result,
    });
  } catch (err) {
    console.error('[authenticity] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
