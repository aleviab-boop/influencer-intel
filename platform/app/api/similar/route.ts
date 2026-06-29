// "Find similar creators" — comparable REACH, not lookalike faces or content.
//
// Given a creator, surface others with a similar follower count and engagement
// rate (same performance bracket), so an agency can find swappable / comparable
// creators. Ranked by follower-tier closeness (log scale) + ER closeness, with
// a small same-niche tiebreak to keep results relevant.

import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { extractContact, type LiveProfile } from '@/lib/live-discovery';

export const runtime = 'nodejs';
export const maxDuration = 20;

interface CreatorRow {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  niche: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  is_verified: boolean | null;
  profile_photo_url: string | null;
  profile_url: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw_metadata: any;
  dist?: number | string;
}

function toLiveProfile(r: CreatorRow, score: number): LiveProfile {
  const bio = r.bio ?? '';
  const contact = extractContact(bio, { externalUrl: r.profile_url ?? null });
  return {
    username: r.handle,
    full_name: r.display_name ?? '',
    biography: bio,
    category: r.primary_category ?? r.niche ?? '',
    followers: Number(r.follower_count ?? 0),
    is_private: false,
    is_verified: Boolean(r.is_verified),
    profile_pic_url: r.profile_photo_url ?? null,
    score,
    engagement: r.engagement_rate != null ? Math.round(Number(r.engagement_rate) * 1000) / 10 : 0,
    email: contact.email,
    phone: contact.phone,
    link: contact.link,
    creator_id: r.id,
    from: 'db' as const,
  };
}

// Engagement rate (%) for the source — prefer the stored rate, else derive from
// the cached recent posts (likes+comments / followers).
function sourceER(r: CreatorRow, followers: number): number {
  if (r.engagement_rate != null) return Number(r.engagement_rate) * 100;
  const posts = Array.isArray(r.raw_metadata?.recent_posts) ? r.raw_metadata.recent_posts : [];
  if (followers > 0 && posts.length > 0) {
    const sum = posts.reduce((s: number, p: { likes?: number; comments?: number }) => s + (p.likes ?? 0) + (p.comments ?? 0), 0);
    return (sum / posts.length / followers) * 100;
  }
  return 0;
}

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '').toLowerCase();
  const max = Math.min(40, Math.max(5, Number(req.nextUrl.searchParams.get('max')) || 24));
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    return NextResponse.json({ error: 'bad handle' }, { status: 400 });
  }

  const db = getBolticClient();
  let src: CreatorRow | undefined;
  try {
    const rows = await db.query<CreatorRow>(
      `SELECT id, handle, display_name, bio, primary_category, niche, follower_count,
              engagement_rate, raw_metadata
       FROM creators WHERE platform = 'instagram' AND lower(handle) = $1 LIMIT 1`,
      [handle],
    );
    src = rows[0];
  } catch {
    return NextResponse.json({ error: 'db' }, { status: 500 });
  }
  if (!src) return NextResponse.json({ error: 'not_found', message: 'Creator not in your database.' }, { status: 404 });

  const srcFollowers = Number(src.follower_count ?? 0);
  if (srcFollowers <= 0) return NextResponse.json({ error: 'no_followers', message: 'No follower data for this creator yet.' }, { status: 422 });
  const lnF = Math.log(srcFollowers);
  const srcEr = sourceER(src, srcFollowers); // %
  const cat = (src.primary_category ?? src.niche ?? '').toLowerCase();

  // Rank candidates by: follower-tier distance (log) + ER distance (where known,
  // normalised by 5 points) + a 0.4 penalty for a different niche.
  let results: LiveProfile[];
  try {
    const rows = await db.query<CreatorRow>(
      `SELECT *,
         ( abs(ln(greatest(follower_count, 1)::float8) - $2::float8)
           + CASE WHEN engagement_rate IS NOT NULL AND $3::float8 > 0
                  THEN abs(engagement_rate * 100 - $3::float8) / 5.0 ELSE 0 END
           -- niche relevance dominates: a same-space creator within ~3x the
           -- followers beats a different-space exact size match.
           + CASE WHEN $4 <> '' AND lower(coalesce(primary_category, niche, '')) = $4 THEN 0 ELSE 1.2 END
         ) AS dist
       FROM creators
       WHERE platform = 'instagram' AND is_active = true
         AND lower(handle) <> $1 AND follower_count > 0
         AND (is_indian = true OR is_indian IS NULL)
       ORDER BY dist ASC
       LIMIT $5::int`,
      [handle, lnF, srcEr, cat, max],
    );
    results = rows.map((r) => {
      // Turn the distance into a 0-100 "match" score (closer = higher).
      const d = Number(r.dist ?? 0);
      const score = Math.max(0, Math.min(100, Math.round(100 - d * 22)));
      return toLiveProfile(r, score);
    });
  } catch {
    return NextResponse.json({ error: 'search_failed' }, { status: 500 });
  }

  return NextResponse.json({ source: src.handle, results });
}
