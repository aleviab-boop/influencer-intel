import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { scoreAuthenticity } from '@/lib/authenticity';
import { getVerifiedEngagement } from '@/lib/verified-metrics';

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

    // Prefer OAuth-verified reach-based engagement when the creator has synced it.
    const verified = await getVerifiedEngagement(handle);

    const result = scoreAuthenticity({
      follower_count: c.follower_count as number | null,
      following_count: c.following_count as number | null,
      avg_likes: c.avg_likes as number | null,
      avg_comments: c.avg_comments as number | null,
      engagement_rate: c.engagement_rate as number | null,
      cred_score: c.cred_score as string | null,
      recent_posts: (c.recent_posts as []) ?? [],
      verified,
    });

    const followers = Number(c.follower_count) || 0;

    // Per-post breakdown + aggregate metrics for display (when posts exist).
    const { posts, metrics } = buildPostBreakdown(c.recent_posts, followers);

    return NextResponse.json({
      handle: c.handle,
      display_name: c.display_name,
      followers,
      ...result,
      posts,
      metrics,
    });
  } catch (err) {
    console.error('[authenticity] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

interface PostView { url: string | null; type: string | null; posted_at: string | null; likes: number; comments: number; views: number; er_pct: number }
interface Metrics { posts: number; avg_likes: number; avg_comments: number; avg_views: number; median_er_pct: number; median_cpl_pct: number; consistency: 'steady' | 'variable' | 'erratic'; top_er_pct: number; low_er_pct: number }

function buildPostBreakdown(raw: unknown, followers: number): { posts: PostView[]; metrics: Metrics | null } {
  const arr = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const posts: PostView[] = arr
    .map((p) => {
      const likes = n(p.like_count);
      const comments = n(p.comment_count);
      const views = n(p.view_count);
      const er = followers > 0 ? ((likes + comments) / followers) * 100 : 0;
      return { url: (p.post_url as string) ?? null, type: (p.post_type as string) ?? null, posted_at: (p.posted_at as string) ?? null, likes, comments, views, er_pct: Number(er.toFixed(2)) };
    })
    .filter((p) => p.likes + p.comments > 0)
    .sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));

  if (posts.length === 0) return { posts: [], metrics: null };

  const ers = posts.map((p) => p.er_pct);
  const cpls = posts.filter((p) => p.likes > 0).map((p) => (p.comments / p.likes) * 100);
  const mean = ers.reduce((a, b) => a + b, 0) / ers.length;
  const cv = mean > 0 ? Math.sqrt(ers.reduce((a, b) => a + (b - mean) ** 2, 0) / ers.length) / mean : 0;
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

  const metrics: Metrics = {
    posts: posts.length,
    avg_likes: avg(posts.map((p) => p.likes)),
    avg_comments: avg(posts.map((p) => p.comments)),
    avg_views: avg(posts.map((p) => p.views)),
    median_er_pct: Number(median(ers).toFixed(2)),
    median_cpl_pct: Number((cpls.length ? median(cpls) : 0).toFixed(2)),
    consistency: cv < 0.3 ? 'steady' : cv <= 1.2 ? 'variable' : 'erratic',
    top_er_pct: Math.max(...ers),
    low_er_pct: Math.min(...ers),
  };
  return { posts, metrics };
}
