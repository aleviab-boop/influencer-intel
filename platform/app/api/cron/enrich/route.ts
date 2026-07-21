import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { igFetch } from '@/lib/ig-fetch';
import { completenessScore } from '@/lib/live-discovery';

export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/cron/enrich
//   Background stub-enrichment. Finds a small batch of un-enriched creators
//   (data_completeness <= 3, no followers, never scraped — mostly AI-suggested
//   stubs) and fills in their real Instagram data, so "save everything" pays off.
//   SAFETY: only runs when >= 2 accounts are healthy, in tiny batches, and BACKS
//   OFF the moment it sees a 401/403/429 — so it can never throttle the pool.
//   Confirmed-404 stubs (AI hallucinations) get retired (is_active=false).
//   Triggered by the on-host relay keeper every ~5 min + a daily Vercel cron.

const APP_ID = '936619743392459';
const HEADERS: Record<string, string> = {
  'x-ig-app-id': APP_ID,
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.instagram.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Site': 'same-origin',
};
const PROFILE_URL = (u: string) =>
  `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(u)}`;

// Batch is paired with the ~2-min trigger interval in run-relay.sh: 5 every 2min
// ≈ 150/hr total (~75/account across 2 accounts) — under the safe rate, just more
// responsive than one big batch every 5 min. Still stops instantly on a 429.
const BATCH = 5;
const DELAY_MS = 700; // pace between fetches

interface IGUser {
  full_name?: string;
  biography?: string;
  category_name?: string;
  is_verified?: boolean;
  profile_pic_url_hd?: string;
  profile_pic_url?: string;
  edge_followed_by?: { count?: number };
  edge_owner_to_timeline_media?: {
    edges?: Array<{ node?: { edge_liked_by?: { count?: number }; edge_media_to_comment?: { count?: number } } }>;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getBolticClient();

  // SAFETY GATE 1: need >= 3 healthy accounts before enrichment runs, so a small
  // pool is reserved ENTIRELY for user-facing live search. With only 1-2 accounts,
  // background enrichment (5 fetches / 2 min) competes for the same cookies and
  // pushes them into 429 rate-limiting — starving live search. Requiring headroom
  // (3+) means enrichment only runs when there's spare capacity, and pauses itself
  // the moment the pool shrinks, letting throttled accounts recover.
  let ready = 0;
  try {
    const r = await db.query<{ n: number }>(
      `SELECT count(*) FILTER (WHERE storage_state IS NOT NULL AND status='active' AND (storage_expires_at IS NULL OR storage_expires_at > now()))::int AS n
       FROM service_accounts WHERE platform='instagram'`,
    );
    ready = Number(r[0]?.n ?? 0);
  } catch {
    return NextResponse.json({ error: 'db' }, { status: 500 });
  }
  if (ready < 3) return NextResponse.json({ skipped: 'need >= 3 healthy accounts (small pool reserved for live search)', ready });

  // Pick a batch of un-enriched stubs (newest discoveries first — most likely
  // to be searched/relevant soon).
  let stubs: Array<{ id: string; handle: string }> = [];
  try {
    stubs = await db.query<{ id: string; handle: string }>(
      `SELECT id, handle FROM creators
       WHERE platform='instagram' AND is_active=true
         AND coalesce(data_completeness,0) <= 3
         AND coalesce(follower_count,0) = 0
         AND last_scraped_at IS NULL
         AND source = 'scrape'
       ORDER BY first_indexed_at DESC NULLS LAST
       LIMIT ${BATCH}`,
    );
  } catch {
    return NextResponse.json({ error: 'query' }, { status: 500 });
  }
  if (stubs.length === 0) return NextResponse.json({ ready, picked: 0, enriched: 0, pruned: 0 });

  let enriched = 0, pruned = 0, throttled = false;
  for (const s of stubs) {
    let res: Response;
    try {
      res = await igFetch(PROFILE_URL(s.handle), { headers: HEADERS });
    } catch {
      throttled = true; // relay unreachable → stop; try next run
      break;
    }
    // SAFETY GATE 2: any throttle/auth signal → stop immediately, leave the rest.
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      throttled = true;
      break;
    }
    let user: IGUser | null = null;
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { data?: { user?: IGUser } } | null;
      user = j?.data?.user ?? null;
    }

    if (!user) {
      // Confirmed non-existent (404, or 200 with null user) → AI hallucination.
      // Retire it (guarded to sparse never-enriched scrape stubs only).
      try {
        await db.query(
          `UPDATE creators SET is_active=false
           WHERE id=$1 AND source='scrape' AND last_scraped_at IS NULL AND coalesce(follower_count,0)=0 AND coalesce(data_completeness,0) <= 3`,
          [s.id],
        );
        pruned++;
      } catch { /* skip */ }
    } else {
      const followers = user.edge_followed_by?.count ?? 0;
      const photo = user.profile_pic_url_hd ?? user.profile_pic_url ?? null;
      // Live ER from recent posts, if the payload carries them.
      const edges = user.edge_owner_to_timeline_media?.edges ?? [];
      let er: number | null = null;
      if (followers > 0 && edges.length > 0) {
        const avg = edges.reduce((sum, e) => sum + (e.node?.edge_liked_by?.count ?? 0) + (e.node?.edge_media_to_comment?.count ?? 0), 0) / edges.length;
        er = Math.round((avg / followers) * 1000) / 10; // %
      }
      const score = completenessScore({
        full_name: user.full_name,
        biography: user.biography,
        category: user.category_name,
        profile_pic_url: photo,
        followers,
        engagement: er ?? 0,
      });
      try {
        await db.query(
          `UPDATE creators SET
             display_name = coalesce(nullif($2,''), display_name),
             bio = coalesce(nullif($3,''), bio),
             primary_category = coalesce(nullif($4,''), primary_category),
             profile_photo_url = coalesce($5, profile_photo_url),
             follower_count = $6,
             is_verified = $7,
             engagement_rate = coalesce($8, engagement_rate),
             data_completeness = $9,
             last_scraped_at = now()
           WHERE id = $1`,
          [s.id, user.full_name ?? '', user.biography ?? '', user.category_name ?? '', photo, followers, Boolean(user.is_verified), er != null ? er / 100 : null, score],
        );
        enriched++;
      } catch { /* skip a bad row */ }
    }
    await sleep(DELAY_MS);
  }

  return NextResponse.json({ ready, picked: stubs.length, enriched, pruned, throttled });
}
