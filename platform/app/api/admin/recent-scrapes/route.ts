import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// GET /api/admin/recent-scrapes
//   The creators the worker most recently scraped (so the Scraper page shows a
//   live feed of the crawl working) + the service-account rotation pool.
export async function GET() {
  const db = getBolticClient();

  let creators: Array<Record<string, unknown>> = [];
  try {
    creators = await db.query(
      `SELECT handle, display_name, follower_count, primary_category, niche,
              is_verified, profile_photo_url, last_scraped_at
       FROM creators
       WHERE last_scraped_at IS NOT NULL
       ORDER BY last_scraped_at DESC
       LIMIT 25`,
    );
  } catch {
    creators = [];
  }

  let accounts: Array<Record<string, unknown>> = [];
  try {
    accounts = await db.query(
      `SELECT handle, status, coalesce(daily_action_count, 0) AS daily_action_count,
              coalesce(total_scrapes, 0) AS total_scrapes,
              storage_captured_at, storage_expires_at, cooldown_until, last_used_at
       FROM service_accounts
       WHERE platform = 'instagram'
       ORDER BY storage_captured_at DESC NULLS LAST`,
    );
  } catch {
    accounts = [];
  }

  // The crawl the worker is running right now (if any), for a live status line.
  let activeCrawl: { target: string; started_at: string } | null = null;
  try {
    const rows = await db.query<{ target_handle: string; started_at: string }>(
      `SELECT target_handle, started_at FROM scrape_jobs
       WHERE job_type = 'search_query' AND status = 'in_progress'
       ORDER BY started_at DESC LIMIT 1`,
    );
    if (rows[0]) activeCrawl = { target: rows[0].target_handle, started_at: rows[0].started_at };
  } catch {
    activeCrawl = null;
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  // The account crawling *right now* = the one used most recently, within a
  // short window (a single crawl runs a few minutes; the worker stamps
  // last_used_at at job-pick). Beyond the window, nobody is "active".
  const ACTIVE_WINDOW_MS = 6 * 60 * 1000;
  let activeHandle: string | null = null;
  let activeTs = 0;
  for (const a of accounts) {
    const lu = a.last_used_at ? new Date(a.last_used_at as string).getTime() : 0;
    if (lu > activeTs && now - lu < ACTIVE_WINDOW_MS) {
      activeTs = lu;
      activeHandle = a.handle as string;
    }
  }
  return NextResponse.json({
    activeCrawl,
    creators: creators.map((c) => ({
      handle: c.handle,
      display_name: (c.display_name as string) ?? '',
      follower_count: c.follower_count == null ? null : Number(c.follower_count),
      category: ((c.primary_category as string) || (c.niche as string)) ?? '',
      is_verified: Boolean(c.is_verified),
      profile_photo_url: (c.profile_photo_url as string) ?? null,
      last_scraped_at: c.last_scraped_at,
    })),
    accounts: accounts.map((a) => {
      const exp = a.storage_expires_at ? new Date(a.storage_expires_at as string).getTime() : null;
      const expired = exp != null && exp < now;
      const cd = a.cooldown_until ? new Date(a.cooldown_until as string).getTime() : null;
      const cooling = cd != null && cd > now;
      // A long cooldown (>2 days) = parked: a dead session or a manual pause —
      // it needs a re-capture / un-pause, not just time. A short one = resting
      // off a rate-limit. Expiry beats everything (session no longer valid).
      const state: 'ready' | 'cooling' | 'parked' | 'expired' =
        expired ? 'expired' : cooling ? (cd! - now > 2 * DAY ? 'parked' : 'cooling') : 'ready';
      return {
        handle: a.handle,
        state,
        status: (a.status as string) ?? 'unknown',
        daily_action_count: Number(a.daily_action_count),
        total_scrapes: Number(a.total_scrapes),
        captured_at: a.storage_captured_at,
        expires_at: a.storage_expires_at,
        cooldown_until: a.cooldown_until ?? null,
        last_used_at: a.last_used_at ?? null,
        active: a.handle === activeHandle,
        expired,
      };
    }),
  });
}
