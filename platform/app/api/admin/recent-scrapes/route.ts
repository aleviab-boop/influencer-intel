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
              storage_captured_at, storage_expires_at
       FROM service_accounts
       WHERE platform = 'instagram'
       ORDER BY storage_captured_at DESC NULLS LAST`,
    );
  } catch {
    accounts = [];
  }

  const now = Date.now();
  return NextResponse.json({
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
      return {
        handle: a.handle,
        status: expired ? 'expired' : (a.status as string) ?? 'unknown',
        daily_action_count: Number(a.daily_action_count),
        total_scrapes: Number(a.total_scrapes),
        captured_at: a.storage_captured_at,
        expires_at: a.storage_expires_at,
        expired,
      };
    }),
  });
}
