import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { extractContact, type LiveProfile } from '@/lib/live-discovery';

export const runtime = 'nodejs';

// GET /api/crawl-search/status?id=<job_id>
//   → { status, done, results }
//
// Polled by the client after POST /api/crawl-search. Returns the worker job's
// status plus every creator the worker tagged with `search:<job_id>` (mapped to
// the same LiveProfile shape the results table renders). The worker upserts +
// tags creators as it discovers them, so results grow across polls.
interface Row {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  is_verified: boolean | null;
  profile_photo_url: string | null;
  source: string | null;
}

function mapRow(r: Row): LiveProfile {
  const contact = extractContact(r.bio);
  return {
    username: r.handle,
    full_name: r.display_name ?? '',
    biography: r.bio ?? '',
    category: r.primary_category ?? '',
    followers: Number(r.follower_count ?? 0),
    is_private: false,
    is_verified: Boolean(r.is_verified),
    profile_pic_url: r.profile_photo_url ?? null,
    score: 1,
    engagement: r.engagement_rate != null ? Math.round(Number(r.engagement_rate) * 1000) / 10 : 0,
    email: contact.email,
    phone: contact.phone,
    link: contact.link,
    creator_id: r.id,
    from: 'live' as const,
    loc_match: false,
    curated: false,
  };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getBolticClient();

  let status = 'unknown';
  try {
    const jobs = await db.query<{ status: string }>(
      `SELECT status FROM scrape_jobs WHERE id = $1 LIMIT 1`,
      [id],
    );
    status = jobs[0]?.status ?? 'unknown';
  } catch (err) {
    console.error('[crawl-search/status] job lookup failed:', err);
  }

  let results: LiveProfile[] = [];
  try {
    const rows = await db.query<Row>(
      `SELECT id, handle, display_name, bio, primary_category, follower_count,
              engagement_rate, is_verified, profile_photo_url, source
       FROM creators
       WHERE platform = 'instagram' AND is_active = true
         AND tags @> ARRAY[$1]::text[]
       ORDER BY follower_count DESC NULLS LAST
       LIMIT 80`,
      [`search:${id}`],
    );
    results = rows.map(mapRow);
  } catch (err) {
    console.error('[crawl-search/status] results query failed:', err);
  }

  const done = ['completed', 'failed', 'skipped'].includes(status);
  return NextResponse.json({ status, done, results });
}
