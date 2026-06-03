import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { Creator } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

interface GeoPost {
  code: string;
  timestamp: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
  caption_excerpt: string | null;
  location: string | null;
  media_type: string | null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as {
    handle?: string;
    creator_id?: string;
    post_url: string;
  };

  if (!body.post_url || (!body.handle && !body.creator_id)) {
    return NextResponse.json(
      { error: 'post_url and (handle or creator_id) required' },
      { status: 400 },
    );
  }

  const db = getBolticClient();

  let creator: Creator | null = null;
  if (body.handle) {
    const rows = await db.query<Creator>(
      'SELECT * FROM creators WHERE handle = $1 LIMIT 1',
      [body.handle.toLowerCase().replace(/^@/, '')],
    );
    creator = rows[0] ?? null;
  } else {
    creator = await db.findById<Creator>('creators', body.creator_id!);
  }

  if (!creator) {
    return NextResponse.json({ error: 'Creator not found' }, { status: 404 });
  }

  const shortcode = extractShortcode(body.post_url);
  if (!shortcode) {
    return NextResponse.json(
      { error: 'Invalid Instagram post URL' },
      { status: 400 },
    );
  }

  const followerCount = Number(creator.follower_count) || 0;
  const baselineEr =
    creator.engagement_rate != null ? Number(creator.engagement_rate) : null;
  const avgLikes =
    creator.avg_likes != null ? Number(creator.avg_likes) : null;
  const avgComments =
    creator.avg_comments != null ? Number(creator.avg_comments) : null;
  const avgViews =
    creator.avg_views != null ? Number(creator.avg_views) : null;

  const geoPosts = (
    (creator.raw_metadata as unknown as Record<string, unknown>)?.geo as Record<
      string,
      unknown
    >
  )?.posts as GeoPost[] | undefined;
  const recentPosts = (creator.recent_posts ?? []) as Array<{
    platform_post_id: string;
    post_url: string;
    post_type: string | null;
    caption: string | null;
    posted_at: string | null;
    like_count: number | null;
    comment_count: number | null;
    view_count: number | null;
  }>;

  let matchedPost: GeoPost | null = null;
  let matchSource: 'geo' | 'recent' = 'geo';

  if (geoPosts) {
    matchedPost = geoPosts.find((p) => p.code === shortcode) ?? null;
  }
  if (!matchedPost && recentPosts.length > 0) {
    const rp = recentPosts.find(
      (p) =>
        p.platform_post_id === shortcode || p.post_url?.includes(shortcode),
    );
    if (rp) {
      matchedPost = {
        code: shortcode,
        timestamp: rp.posted_at ?? '',
        likes: rp.like_count ?? 0,
        comments: rp.comment_count ?? 0,
        views: rp.view_count ?? null,
        caption_excerpt: rp.caption ?? null,
        location: null,
        media_type: rp.post_type,
      };
      matchSource = 'recent';
    }
  }

  const creatorSummary = {
    handle: creator.handle,
    display_name: creator.display_name,
    profile_photo_url: creator.profile_photo_url ?? null,
    follower_count: followerCount,
    baseline_er: baselineEr,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    avg_views: avgViews,
  };

  const allPosts = (geoPosts ?? [])
    .map((p) => {
      const likes = p.likes ?? 0;
      const comments = p.comments ?? 0;
      const interactions = likes + comments;
      const er = followerCount > 0 ? interactions / followerCount : 0;
      return {
        code: p.code,
        permalink: `https://www.instagram.com/p/${p.code}/`,
        posted_at: p.timestamp || null,
        media_type: p.media_type,
        likes,
        comments,
        views: p.views ?? null,
        engagement_rate: er,
        performance_bucket: computeBucket(er, baselineEr),
      };
    })
    .sort((a, b) => {
      const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
      const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
      return tb - ta;
    });

  if (!matchedPost) {
    return NextResponse.json({
      found: false,
      shortcode,
      creator: creatorSummary,
      all_posts: allPosts,
      message:
        'Post not in scraped data. Try a recent post or connect Instagram for real-time monitoring.',
    });
  }

  const likes = matchedPost.likes ?? 0;
  const comments = matchedPost.comments ?? 0;
  const views = matchedPost.views ?? null;
  const interactions = likes + comments;
  const er = followerCount > 0 ? interactions / followerCount : 0;
  const bucket = computeBucket(er, baselineEr);

  return NextResponse.json({
    found: true,
    source: matchSource,
    shortcode,
    post: {
      code: matchedPost.code,
      permalink: `https://www.instagram.com/p/${matchedPost.code}/`,
      posted_at: matchedPost.timestamp || null,
      media_type: matchedPost.media_type,
      caption: matchedPost.caption_excerpt?.substring(0, 200) ?? null,
      location: matchedPost.location ?? null,
      metrics: {
        likes,
        comments,
        views,
        saves: null,
        shares: null,
        reach: null,
      },
      engagement_rate: er,
      performance_bucket: bucket,
    },
    creator: creatorSummary,
    comparison: {
      er_vs_baseline:
        baselineEr && baselineEr > 0 ? er / baselineEr : null,
      likes_vs_avg: avgLikes && avgLikes > 0 ? likes / avgLikes : null,
      comments_vs_avg:
        avgComments && avgComments > 0 ? comments / avgComments : null,
      views_vs_avg:
        avgViews && avgViews > 0 && views ? views / avgViews : null,
    },
    all_posts: allPosts,
    note: 'Scraped snapshot. Connect Instagram for real-time monitoring with saves, shares, reach.',
  });
}

function extractShortcode(url: string): string | null {
  const match = url.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function computeBucket(
  er: number,
  baselineEr: number | null,
): string {
  if (!baselineEr || baselineEr <= 0) {
    if (er >= 0.06) return 'breakout';
    if (er >= 0.03) return 'above_average';
    if (er >= 0.01) return 'average';
    return 'below_average';
  }
  const ratio = er / baselineEr;
  if (ratio >= 2.0) return 'breakout';
  if (ratio >= 1.3) return 'above_average';
  if (ratio >= 0.7) return 'average';
  return 'below_average';
}
