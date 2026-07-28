import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// GET /api/admin/metrics
//   Observability snapshot for the Super Admin → Metrics page. All read-only,
//   drawn from data we already capture:
//     • scrape_jobs      → who's crawling now + for how long, throughput, queue
//     • service_accounts → account roster health (scrapes, cooldowns, expiry)
//     • agency_searches  → what was searched live + search volume/top niches
//   No writes, no IG hits — safe to poll.

type Row = Record<string, unknown>;

export async function GET() {
  const db = getBolticClient();

  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => {
    try {
      return (await db.query<T>(sql, params)) as T[];
    } catch {
      return [];
    }
  };
  const one = async (sql: string, params: unknown[] = []): Promise<number> => {
    const r = await rows<{ n: number | string }>(sql, params);
    return Number(r[0]?.n ?? 0);
  };

  const [
    // headline counters
    queued,
    inProgress,
    completed24h,
    skipped24h,
    failed24h,
    avgDurationSec,
    oldestQueuedAt,
    searchesToday,
    searches24h,
    searches7d,
    // detail sets
    liveCrawls,
    hourlyThroughput,
    accounts,
    recentSearches,
    searchesPerDay,
    topNiches,
    // worker heartbeat
    heartbeat,
  ] = await Promise.all([
    one(`SELECT count(*)::int n FROM scrape_jobs WHERE status='queued'`),
    one(`SELECT count(*)::int n FROM scrape_jobs WHERE status='in_progress'`),
    one(`SELECT count(*)::int n FROM scrape_jobs WHERE status='completed' AND completed_at > now() - interval '24 hours'`),
    one(`SELECT count(*)::int n FROM scrape_jobs WHERE status='skipped' AND completed_at > now() - interval '24 hours'`),
    one(`SELECT count(*)::int n FROM scrape_jobs WHERE status='failed' AND completed_at > now() - interval '24 hours'`),
    one(
      `SELECT avg(extract(epoch FROM (completed_at - started_at)))::int n
         FROM scrape_jobs
        WHERE status='completed' AND completed_at > now() - interval '24 hours'
          AND started_at IS NOT NULL AND completed_at >= started_at`,
    ),
    rows<{ t: string | null }>(`SELECT min(queued_at) t FROM scrape_jobs WHERE status='queued'`).then((r) => r[0]?.t ?? null),
    one(`SELECT count(*)::int n FROM agency_searches WHERE created_at > date_trunc('day', now())`),
    one(`SELECT count(*)::int n FROM agency_searches WHERE created_at > now() - interval '24 hours'`),
    one(`SELECT count(*)::int n FROM agency_searches WHERE created_at > now() - interval '7 days'`),

    // Who's crawling right now — in-progress jobs + how long they've been running,
    // with the account handle doing the work.
    rows(
      `SELECT j.target_handle, j.job_type, j.status, j.attempts::int attempts, j.started_at,
              extract(epoch FROM (now() - j.started_at))::int elapsed_s,
              a.handle AS account
         FROM scrape_jobs j
         LEFT JOIN service_accounts a ON a.id = j.assigned_account_id
        WHERE j.status = 'in_progress' AND j.started_at IS NOT NULL
        ORDER BY j.started_at ASC
        LIMIT 30`,
    ),

    // Completed jobs per hour over the last 24h (for a mini bar chart). NB: `hour`
    // / `day` are reserved and error as column aliases here — use `bucket`.
    rows(
      `SELECT to_char(date_trunc('hour', completed_at), 'YYYY-MM-DD HH24:00') AS bucket, count(*)::int n
         FROM scrape_jobs
        WHERE status='completed' AND completed_at > now() - interval '24 hours'
        GROUP BY 1 ORDER BY 1`,
    ),

    // Account roster health — activity, cooldowns, session expiry, + jobs done 24h.
    rows(
      `SELECT a.handle, a.status,
              coalesce(a.total_scrapes,0)::int total_scrapes,
              coalesce(a.daily_action_count,0)::int daily_actions,
              a.last_used_at, a.cooldown_until, a.storage_expires_at,
              a.category_focus, a.geo_focus,
              coalesce(c.n,0)::int jobs_24h
         FROM service_accounts a
         LEFT JOIN (
           SELECT assigned_account_id, count(*) n
             FROM scrape_jobs
            WHERE completed_at > now() - interval '24 hours'
            GROUP BY 1
         ) c ON c.assigned_account_id = a.id
        WHERE a.platform = 'instagram'
        ORDER BY a.last_used_at DESC NULLS LAST
        LIMIT 50`,
    ),

    // Live search feed — the actual prompts users ran + results returned.
    rows(
      `SELECT prompt, coalesce(result_count,0)::int result_count, created_at
         FROM agency_searches ORDER BY created_at DESC LIMIT 40`,
    ),

    // Searches per day, last 14 days.
    rows(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS bucket, count(*)::int n
         FROM agency_searches
        WHERE created_at > now() - interval '14 days'
        GROUP BY 1 ORDER BY 1`,
    ),

    // Top searched niches/tokens over the last 7 days.
    rows(
      `SELECT lower(tok) AS token, count(*)::int n
         FROM agency_searches, unnest(tokens) tok
        WHERE created_at > now() - interval '7 days' AND tok IS NOT NULL AND length(tok) > 2
        GROUP BY 1 ORDER BY n DESC, token LIMIT 15`,
    ),

    rows<{ t: string | null }>(`SELECT beat_at t FROM worker_heartbeat WHERE worker='main'`).then((r) => r[0]?.t ?? null),
  ]);

  const lastBeat = heartbeat as string | null;
  const workerLive = !!(lastBeat && Date.now() - new Date(lastBeat).getTime() < 90_000);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    worker: { live: workerLive, last_beat_at: lastBeat },
    headline: {
      queued,
      in_progress: inProgress,
      completed_24h: completed24h,
      skipped_24h: skipped24h,
      failed_24h: failed24h,
      avg_duration_sec: avgDurationSec,
      oldest_queued_at: oldestQueuedAt,
      searches_today: searchesToday,
      searches_24h: searches24h,
      searches_7d: searches7d,
    },
    live_crawls: liveCrawls,
    hourly_throughput: hourlyThroughput,
    accounts,
    recent_searches: recentSearches,
    searches_per_day: searchesPerDay,
    top_niches: topNiches,
  });
}
