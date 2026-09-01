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
    // users / logins
    loginsToday,
    logins24h,
    dauToday,
    dau7d,
    // detail sets
    liveCrawls,
    hourlyThroughput,
    accounts,
    recentSearches,
    searchesPerDay,
    topNiches,
    loginsPerDay,
    recentLogins,
    // creator database + quality charts
    creatorsTotal,
    creatorGrowth,
    creatorsBySource,
    jobOutcomes7d,
    searchBuckets,
    // brand/agency account roster (with last sign-in)
    registeredAccounts,
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

    // Logins + DAU (distinct active users). A "user" is keyed by brand_id, falling
    // back to email. kind in ('login','signup') = an authenticated session start.
    one(`SELECT count(*)::int n FROM activity_events WHERE kind IN ('login','signup') AND coalesce(meta->>'role','') <> 'admin' AND created_at > date_trunc('day', now())`),
    one(`SELECT count(*)::int n FROM activity_events WHERE kind IN ('login','signup') AND coalesce(meta->>'role','') <> 'admin' AND created_at > now() - interval '24 hours'`),
    one(`SELECT count(DISTINCT coalesce(brand_id::text, email))::int n FROM activity_events WHERE kind IN ('login','signup') AND coalesce(meta->>'role','') <> 'admin' AND created_at > date_trunc('day', now())`),
    one(`SELECT count(DISTINCT coalesce(brand_id::text, email))::int n FROM activity_events WHERE kind IN ('login','signup') AND coalesce(meta->>'role','') <> 'admin' AND created_at > now() - interval '7 days'`),

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

    // Logins per day (last 14d) for the mini bar chart.
    rows(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS bucket, count(*)::int n
         FROM activity_events
        WHERE kind IN ('login','signup') AND coalesce(meta->>'role','') <> 'admin' AND created_at > now() - interval '14 days'
        GROUP BY 1 ORDER BY 1`,
    ),

    // Recent logins feed — who signed in, when. The name is the point-in-time
    // snapshot captured on THAT login (meta.name), NOT the account's current
    // name — so the same email can show a different name each time, and updating
    // a name never retroactively rewrites past rows. Falls back to email when an
    // (older) event has no captured name.
    rows(
      `SELECT email, kind, meta, created_at, nullif(meta->>'name', '') AS name
         FROM activity_events
        WHERE kind IN ('login','signup')
        ORDER BY created_at DESC LIMIT 25`,
    ),

    // Creator database size — for the growth line's cumulative baseline.
    one(`SELECT count(*)::int n FROM creators`),

    // New creators per day, last 30 days — drives the DB-growth line chart.
    rows(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS bucket, count(*)::int n
         FROM creators
        WHERE created_at > now() - interval '30 days'
        GROUP BY 1 ORDER BY 1`,
    ),

    // Where creators came from (icmp / scrape / manual / unknown) — pie.
    rows(
      `SELECT coalesce(nullif(source,''),'unknown') AS source, count(*)::int n
         FROM creators GROUP BY 1 ORDER BY n DESC`,
    ),

    // Job outcomes over 7 days (completed / skipped / failed) — pie + success rate.
    rows(
      `SELECT status, count(*)::int n
         FROM scrape_jobs
        WHERE completed_at > now() - interval '7 days' AND status IN ('completed','skipped','failed')
        GROUP BY 1`,
    ),

    // Search effectiveness — how many searches returned nothing vs a few vs many.
    rows(
      `SELECT count(*) FILTER (WHERE coalesce(result_count,0)=0)::int zero,
              count(*) FILTER (WHERE result_count BETWEEN 1 AND 5)::int small,
              count(*) FILTER (WHERE result_count > 5)::int big
         FROM agency_searches WHERE created_at > now() - interval '30 days'`,
    ).then((r) => r[0] ?? { zero: 0, small: 0, big: 0 }),

    // Registered brand/agency accounts + when each last signed in (migration 049),
    // ordered most-recently-active first so dormant accounts sink. brand_count is
    // how many distinct brands the account owns (brand_dna.account_id).
    rows(
      `SELECT aa.email, aa.name, aa.account_type, aa.created_at, aa.last_login_at,
              coalesce(b.n, 0)::int AS brand_count
         FROM agency_accounts aa
         LEFT JOIN (
           SELECT account_id, count(DISTINCT lower(brand_name)) n
             FROM brand_dna WHERE account_id IS NOT NULL GROUP BY account_id
         ) b ON b.account_id = aa.id
        ORDER BY aa.last_login_at DESC NULLS LAST, aa.created_at DESC
        LIMIT 100`,
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
      logins_today: loginsToday,
      logins_24h: logins24h,
      dau_today: dauToday,
      dau_7d: dau7d,
    },
    live_crawls: liveCrawls,
    hourly_throughput: hourlyThroughput,
    accounts,
    recent_searches: recentSearches,
    searches_per_day: searchesPerDay,
    top_niches: topNiches,
    logins_per_day: loginsPerDay,
    recent_logins: recentLogins,
    registered_accounts: registeredAccounts,
    creators_total: creatorsTotal,
    creator_growth: creatorGrowth,
    creators_by_source: creatorsBySource,
    job_outcomes_7d: jobOutcomes7d,
    search_buckets: searchBuckets,
  });
}
