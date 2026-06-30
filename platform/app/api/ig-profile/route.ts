import { NextRequest, NextResponse } from 'next/server';
import { extractContact } from '@/lib/live-discovery';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';
export const maxDuration = 20;

// GET /api/ig-profile?handle=X
//   Powers the profile drawer. DB-backed: the browser worker (scraper workspace)
//   crawls Instagram with an authenticated session and persists rich profile data
//   (followers, engagement, recent posts, collabs, vision fields) into `creators`.
//   This endpoint serves that worker-built data — it does NOT fetch Instagram from
//   the Vercel server (cloud IPs are blocked by IG; the old cookie/relay path
//   always failed here and fell back to stale "cached" data). When the stored data
//   is missing or stale we enqueue an on_demand worker refresh so the laptop worker
//   re-scrapes and the drawer can poll for the update.

const STALE_MS = 3 * 24 * 60 * 60 * 1000; // re-scrape if older than 3 days

// Enqueue an on_demand worker scrape for this handle, unless one is already
// queued/running (so repeated drawer opens don't flood the queue).
async function enqueueRefresh(handle: string, priority: number): Promise<boolean> {
  const db = getBolticClient();
  try {
    const existing = await db.query(
      `SELECT 1 FROM scrape_jobs
       WHERE job_type = 'on_demand' AND lower(target_handle) = lower($1)
         AND status IN ('queued', 'in_progress') LIMIT 1`,
      [handle],
    );
    if (existing.length > 0) return true; // already in flight
    await db.insert('scrape_jobs', {
      job_type: 'on_demand',
      target_platform: 'instagram',
      target_handle: handle,
      priority,
      status: 'queued',
      attempts: 0,
      queued_at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

// Worker-discovered "similar" creators from the DB (same niche, nearby reach) so
// the drawer's SIMILAR CREATORS panel stays populated without any live IG call.
interface RelatedRow {
  handle: string;
  display_name: string | null;
  is_verified: boolean | null;
  profile_photo_url: string | null;
}
async function dbRelated(handle: string, niche: string, followers: number) {
  if (!niche) return [];
  try {
    const rows = await getBolticClient().query<RelatedRow>(
      `SELECT handle, display_name, is_verified, profile_photo_url
       FROM creators
       WHERE platform = 'instagram' AND is_active = true
         AND lower(handle) <> lower($1)
         AND lower(coalesce(primary_category, niche, '')) = lower($2)
       ORDER BY abs(coalesce(follower_count, 0) - $3) ASC
       LIMIT 8`,
      [handle, niche, followers],
    );
    return rows
      .map((r) => ({
        handle: r.handle,
        full_name: r.display_name ?? '',
        is_verified: Boolean(r.is_verified),
        profile_pic_url: r.profile_photo_url ?? null,
      }))
      .filter((r) => r.handle);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    return NextResponse.json({ error: 'bad handle' }, { status: 400 });
  }
  // ?force=1 → user hit "Refresh": always queue a worker re-scrape.
  const force = req.nextUrl.searchParams.get('force') === '1';

  let rows: Record<string, unknown>[] = [];
  try {
    rows = await getBolticClient().query<Record<string, unknown>>(
      `SELECT handle, display_name, bio, primary_category, niche, follower_count,
              following_count, posts_count, engagement_rate, profile_photo_url,
              profile_url, is_verified, primary_city, raw_metadata, last_scraped_at
       FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
  } catch {
    rows = [];
  }

  const c = rows[0];

  // Not in the DB yet → queue the worker to scrape it, return a pending shell so
  // the drawer can show "scraping…" and poll.
  if (!c) {
    const refreshing = await enqueueRefresh(handle, 1);
    return NextResponse.json({
      handle,
      full_name: '',
      biography: '',
      category: '',
      followers: 0,
      following: 0,
      posts: 0,
      is_verified: false,
      is_private: false,
      profile_pic_url: null,
      external_url: null,
      email: null,
      phone: null,
      recent: [],
      related: [],
      collabs: [],
      sponsored_posts: 0,
      engagement: null,
      source: 'pending',
      refreshing,
      last_scraped_at: null,
    });
  }

  const bio = (c.bio as string) ?? '';
  const contact = extractContact(bio, { externalUrl: (c.profile_url as string) ?? null });
  const er = c.engagement_rate != null ? Math.round(Number(c.engagement_rate) * 1000) / 10 : null;
  const meta = (c.raw_metadata as Record<string, unknown> | null) ?? {};
  const recent = Array.isArray(meta.recent_posts) ? meta.recent_posts : [];
  const collabs = Array.isArray(meta.collabs) ? meta.collabs : [];
  const sponsored = typeof meta.sponsored_posts === 'number' ? meta.sponsored_posts : 0;
  const niche = ((c.primary_category as string) || (c.niche as string)) ?? '';
  const followers = Number(c.follower_count ?? 0);

  const last = c.last_scraped_at ? new Date(c.last_scraped_at as string).getTime() : 0;
  const stale = !last || Date.now() - last > STALE_MS || recent.length === 0;
  const refreshing = force || stale ? await enqueueRefresh(handle, force ? 1 : 2) : false;

  const related = await dbRelated(handle, niche, followers);

  return NextResponse.json({
    handle: c.handle,
    full_name: (c.display_name as string) ?? '',
    biography: bio,
    category: niche,
    followers,
    following: Number(c.following_count ?? 0),
    posts: Number(c.posts_count ?? 0),
    is_verified: Boolean(c.is_verified),
    is_private: false,
    profile_pic_url: (c.profile_photo_url as string) ?? null,
    external_url: contact.link,
    email: contact.email,
    phone: contact.phone,
    recent,
    related,
    collabs,
    sponsored_posts: sponsored,
    engagement: er,
    source: 'db',
    last_scraped_at: (c.last_scraped_at as string) ?? null,
    refreshing,
  });
}
