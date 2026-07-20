import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// GET /api/admin/stats
//   Snapshot for the admin dashboard + scraper page: how big the DB is, how much
//   the scraper has crawled recently, the job queue depth, and the account pool.
export async function GET() {
  const db = getBolticClient();
  const one = async (sql: string, params: unknown[] = []): Promise<number> => {
    try {
      const rows = await db.query<{ n: number | string }>(sql, params);
      return Number(rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  };

  const [
    totalCreators,
    activeCreators,
    scraped24h,
    scraped1h,
    queued,
    inProgress,
    completed24h,
    failed24h,
    activeAccounts,
  ] = await Promise.all([
    one(`SELECT count(*)::int AS n FROM creators WHERE platform='instagram'`),
    one(`SELECT count(*)::int AS n FROM creators WHERE platform='instagram' AND is_active = true`),
    // Count BOTH freshly-discovered (first_indexed_at, set by search/crawl
    // persist) AND freshly-enriched (last_scraped_at, set by the drawer live
    // fetch). The old query only saw last_scraped_at, so hundreds of creators
    // added by search discovery never showed up — the number looked frozen.
    one(`SELECT count(*)::int AS n FROM creators WHERE platform='instagram' AND (last_scraped_at > NOW() - INTERVAL '24 hours' OR first_indexed_at > NOW() - INTERVAL '24 hours')`),
    one(`SELECT count(*)::int AS n FROM creators WHERE platform='instagram' AND (last_scraped_at > NOW() - INTERVAL '1 hour' OR first_indexed_at > NOW() - INTERVAL '1 hour')`),
    one(`SELECT count(*)::int AS n FROM scrape_jobs WHERE status='queued'`),
    one(`SELECT count(*)::int AS n FROM scrape_jobs WHERE status='in_progress'`),
    one(`SELECT count(*)::int AS n FROM scrape_jobs WHERE status='completed' AND completed_at > NOW() - INTERVAL '24 hours'`),
    one(`SELECT count(*)::int AS n FROM scrape_jobs WHERE status='failed' AND completed_at > NOW() - INTERVAL '24 hours'`),
    one(`SELECT count(*)::int AS n FROM service_accounts WHERE platform='instagram' AND status='active' AND storage_state IS NOT NULL AND (storage_expires_at IS NULL OR storage_expires_at > now())`),
  ]);

  // Is the worker "live"? Read its liveness HEARTBEAT — the crawl worker stamps
  // worker_heartbeat every ~15s while its loop runs, so a beat within the last
  // ~90s means it's genuinely up. (The old proxy — max last_scraped_at — also
  // moved on plain search/discovery writes, so it showed "live" even when the
  // crawl worker was dead. The heartbeat only moves when the worker itself runs.)
  const lastBeat = await db
    .query<{ t: string | null }>(`SELECT beat_at AS t FROM worker_heartbeat WHERE worker = 'main'`)
    .then((r) => r[0]?.t ?? null)
    .catch(() => null);
  const workerLive = !!(lastBeat && Date.now() - new Date(lastBeat).getTime() < 90 * 1000);
  const lastScrape = lastBeat;

  return NextResponse.json({
    creators: { total: totalCreators, active: activeCreators },
    scraped: { last_1h: scraped1h, last_24h: scraped24h },
    jobs: { queued, in_progress: inProgress, completed_24h: completed24h, failed_24h: failed24h },
    accounts: { active: activeAccounts },
    worker_live: workerLive,
    last_scrape_at: lastScrape,
  });
}
