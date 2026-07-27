import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// GET /api/brand-mentions?company=Nykaa&limit=60&months=12
//   Find creators who have recently mentioned/tagged a brand in their posts.
//   Source: creators.recent_posts (json array of {caption, post_url, posted_at,
//   post_type, like_count, comment_count, view_count}). We scan captions for the
//   brand token at a word boundary (so "@nykaafashion"/"#nykaabeauty" count, but
//   a mid-word coincidence does not), and rank creators by their MOST RECENT
//   matching post. Each creator carries its matching posts back as evidence.

interface MatchedPost {
  caption?: string;
  post_url?: string;
  posted_at?: string;
  post_type?: string;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const company = (url.searchParams.get('company') ?? '').trim();
  const limit = Math.min(80, Math.max(1, Number(url.searchParams.get('limit') ?? 60)));
  const months = Number(url.searchParams.get('months') ?? 0); // 0 = no recency cap

  if (company.length < 2) {
    return NextResponse.json({ creators: [], total: 0, company });
  }

  // Word-boundary PREFIX match: the brand may appear as its own word, as an
  // @mention/#hashtag, or as the stem of a sub-brand (nykaafashion). Requiring a
  // non-alphanumeric char (or string start) BEFORE the token avoids matching it
  // as a random substring inside another word, while still allowing sub-brands.
  const esc = company.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = `(^|[^a-z0-9])${esc}`;

  const params: unknown[] = [rx];
  // Optional recency window on the most-recent matching post.
  let recencyClause = '';
  if (Number.isFinite(months) && months > 0) {
    params.push(months);
    recencyClause = `AND m.last_mention > now() - ($${params.length} || ' months')::interval`;
  }
  params.push(limit);
  const limitIdx = params.length;

  try {
    const db = getBolticClient();
    const rows = await db.query<Record<string, unknown>>(
      `SELECT c.id, c.handle, c.display_name, c.profile_photo_url, c.follower_count,
              c.primary_category, c.primary_city, c.primary_state, c.is_verified,
              c.engagement_rate,
              c.credibility->>'overall_score' AS cred_score,
              c.raw_metadata->'vision'->>'niche' AS vision_niche,
              m.mention_count, m.last_mention, m.matched_posts
       FROM creators c
       JOIN LATERAL (
         SELECT jsonb_agg(p ORDER BY (p->>'posted_at') DESC) AS matched_posts,
                max((p->>'posted_at')::timestamptz)         AS last_mention,
                count(*)::int                                AS mention_count
         FROM jsonb_array_elements(c.recent_posts::jsonb) p
         WHERE p->>'caption' ~* $1
       ) m ON m.mention_count > 0
       WHERE c.is_active = true
         AND c.recent_posts IS NOT NULL
         AND jsonb_typeof(c.recent_posts::jsonb) = 'array'
         ${recencyClause}
       ORDER BY m.last_mention DESC NULLS LAST, c.follower_count DESC NULLS LAST
       LIMIT $${limitIdx}`,
      params,
    );

    // Trim evidence to the 3 most-recent matching posts per creator to keep the
    // payload lean (a caption can be long).
    const creators = rows.map((r) => ({
      ...r,
      matched_posts: (Array.isArray(r.matched_posts) ? (r.matched_posts as MatchedPost[]) : []).slice(0, 3),
    }));

    return NextResponse.json({ creators, total: creators.length, company });
  } catch (err) {
    console.error('[brand-mentions] query failed:', err);
    return NextResponse.json({ error: (err as Error).message, creators: [], total: 0, company }, { status: 500 });
  }
}
