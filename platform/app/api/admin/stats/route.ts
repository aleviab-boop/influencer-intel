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
    one(`SELECT count(*)::int AS n FROM creators WHERE last_scraped_at > NOW() - INTERVAL '24 hours'`),
    one(`SELECT count(*)::int AS n FROM creators WHERE last_scraped_at > NOW() - INTERVAL '1 hour'`),
    one(`SELECT count(*)::int AS n FROM scrape_jobs WHERE status='queued'`),
    one(`SELECT count(*)::int AS n FROM scrape_jobs WHERE status='in_progress'`),
    one(`SELECT count(*)::int AS n FROM scrape_jobs WHERE status='completed' AND completed_at > NOW() - INTERVAL '24 hours'`),
    one(`SELECT count(*)::int AS n FROM scrape_jobs WHERE status='failed' AND completed_at > NOW() - INTERVAL '24 hours'`),
    one(`SELECT count(*)::int AS n FROM service_accounts WHERE platform='instagram' AND status='active' AND storage_state IS NOT NULL AND (storage_expires_at IS NULL OR storage_expires_at > now())`),
  ]);

  // Is the worker "live"? A creator scraped in the last ~3 minutes means it's
  // actively running. (in_progress count can be stale — jobs left mid-flight
  // when a worker is killed never flip status — so we don't trust it here.)
  const lastScrape = await db
    .query<{ t: string | null }>(`SELECT max(last_scraped_at) AS t FROM creators`)
    .then((r) => r[0]?.t ?? null)
    .catch(() => null);
  const workerLive = !!(lastScrape && Date.now() - new Date(lastScrape).getTime() < 3 * 60 * 1000);

  return NextResponse.json({
    creators: { total: totalCreators, active: activeCreators },
    scraped: { last_1h: scraped1h, last_24h: scraped24h },
    jobs: { queued, in_progress: inProgress, completed_24h: completed24h, failed_24h: failed24h },
    accounts: { active: activeAccounts },
    worker_live: workerLive,
    last_scrape_at: lastScrape,
  });
}
