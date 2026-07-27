import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// GET /api/brand-mentions?company=Nykaa&limit=60
//   Find creators who work with / have posted about a brand. We match a creator
//   three ways and UNION them, so coverage isn't limited to any single field:
//     1. vision.brand_mentions[]  — brands our vision model read off the profile
//        (carries the paid-partnership signal). Widest coverage.
//     2. collabs[].handle          — accounts the creator @-tagged, persisted
//        from live profile views.
//     3. recent_posts[].caption    — a word-boundary caption scan of their last
//        ~12 posts. Narrowest, but gives us the actual PROOF POST (caption +
//        engagement + link) to show as evidence.
//   Ranked: paid partners first, then most-recent proof post, then followers.

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
  const limit = Math.min(300, Math.max(1, Number(url.searchParams.get('limit') ?? 200)));

  if (company.length < 2) {
    return NextResponse.json({ creators: [], total: 0, company });
  }

  // Regex-escaped brand. Used two ways:
  //   esc      → `\y<esc>\y` word-boundary match against each vision brand mention
  //   capRx    → `(^|[^a-z0-9])<esc>` prefix-at-boundary caption match, so
  //              @nykaafashion / #nykaabeauty count but mid-word coincidences don't.
  const esc = company.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const capRx = `(^|[^a-z0-9])${esc}`;

  try {
    const db = getBolticClient();
    const rows = await db.query<Record<string, unknown>>(
      `SELECT c.id, c.handle, c.display_name, c.profile_photo_url, c.follower_count,
              c.primary_category, c.primary_city, c.primary_state, c.is_verified,
              c.engagement_rate,
              c.credibility->>'overall_score' AS cred_score,
              c.raw_metadata->'vision'->>'niche' AS vision_niche,
              COALESCE((c.raw_metadata->'vision'->>'has_paid_partnership') = 'true', false) AS paid_partner,
              COALESCE(
                (SELECT string_agg(DISTINCT bm.mention, ', ')
                   FROM jsonb_array_elements_text(c.raw_metadata->'vision'->'brand_mentions') bm(mention)
                   WHERE lower(bm.mention) = lower($1) OR lower(bm.mention) ~ ('\\y' || $2 || '\\y')),
                (SELECT string_agg(DISTINCT co->>'handle', ', ')
                   FROM jsonb_array_elements(c.raw_metadata->'collabs') co
                   WHERE lower(co->>'handle') = lower($1) OR lower(co->>'handle') LIKE '%' || lower($1) || '%')
              ) AS matched_brand,
              ev.matched_posts,
              ev.last_mention,
              COALESCE(ev.mention_count, 0) AS mention_count
       FROM creators c
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(p ORDER BY (p->>'posted_at') DESC) AS matched_posts,
                max((p->>'posted_at')::timestamptz)         AS last_mention,
                count(*)::int                                AS mention_count
         FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(c.recent_posts::jsonb) = 'array'
                     THEN c.recent_posts::jsonb ELSE '[]'::jsonb END) p
         WHERE p->>'caption' ~* $3
       ) ev ON true
       WHERE c.is_active = true
         AND (
           (jsonb_typeof(c.raw_metadata->'vision'->'brand_mentions') = 'array' AND EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(c.raw_metadata->'vision'->'brand_mentions') bm(mention)
              WHERE lower(bm.mention) = lower($1) OR lower(bm.mention) ~ ('\\y' || $2 || '\\y')))
           OR
           (jsonb_typeof(c.raw_metadata->'collabs') = 'array' AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(c.raw_metadata->'collabs') co
              WHERE lower(co->>'handle') = lower($1) OR lower(co->>'handle') LIKE '%' || lower($1) || '%'))
           OR COALESCE(ev.mention_count, 0) > 0
         )
       -- Proof first: creators with an actual recent post about the brand lead
       -- (concrete + dated = the strongest "recently worked with" signal), then
       -- verified paid partners, then reach.
       ORDER BY (COALESCE(ev.mention_count, 0) > 0) DESC,
                ev.last_mention DESC NULLS LAST,
                paid_partner DESC,
                c.follower_count DESC NULLS LAST
       LIMIT $4`,
      [company, esc, capRx, limit],
    );

    // Trim evidence to the 3 most-recent matching posts per creator (a caption
    // can be long). Creators matched only via brand_mentions/collabs have none.
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
