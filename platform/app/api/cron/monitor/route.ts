import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { notifySlack } from '@influencer-intel/shared/notify';
import { igFetch } from '@/lib/ig-fetch';

export const runtime = 'nodejs';

// GET /api/cron/monitor
//   Operational watchdog: one pass of health checks that pings Slack when
//   something needs the operator, so nobody has to watch the dashboard. Meant to
//   be hit on a schedule (Vercel cron + the on-host relay keeper curls it too).
//   Alerts are de-duped via alert_state so a persistent problem pings at most
//   once/hour, and a recovery ping fires when a prior problem clears.

const PROBE = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram';
const PROBE_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.instagram.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Site': 'same-origin',
};

// Alerts the operator has intentionally muted (comma-separated alert_state keys).
// Defaults to the FREE-pipeline alerts that become expected noise once discovery
// + enrichment run on the Apify paid fallback: the IG-cookie 401 (`live_cookie`)
// and the worker-idle ping (`worker_stalled`). These monitor the free cookie/relay
// path, which Apify intentionally bypasses — so they'd flap red↔green forever.
// Set MONITOR_MUTED_ALERTS='' to re-enable everything, or list your own keys
// (e.g. live_cookie,worker_stalled,live_relay,live_ratelimit,acct_none).
const MUTED = new Set(
  (process.env.MONITOR_MUTED_ALERTS ?? 'live_cookie,worker_stalled')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// Fire an alert at most once per `cooldownMin` while a problem persists.
async function alertOnce(key: string, text: string, cooldownMin = 60): Promise<void> {
  if (MUTED.has(key)) return; // operator-muted → stay silent
  const db = getBolticClient();
  try {
    const rows = await db.query<{ last_sent_at: string }>(
      `SELECT last_sent_at FROM alert_state WHERE key = $1`,
      [key],
    );
    const last = rows[0]?.last_sent_at ? new Date(rows[0].last_sent_at).getTime() : 0;
    if (Date.now() - last < cooldownMin * 60_000) return; // still in cooldown
    await notifySlack(text);
    await db.query(
      `INSERT INTO alert_state (key, last_sent_at) VALUES ($1, now())
       ON CONFLICT (key) DO UPDATE SET last_sent_at = now()`,
      [key],
    );
  } catch {
    /* best-effort */
  }
}

// Clear a problem's alert state; if it was active, fire a one-line recovery ping.
async function clearAlert(key: string, recoveryText?: string): Promise<void> {
  const db = getBolticClient();
  try {
    const rows = await db.query(`DELETE FROM alert_state WHERE key = $1 RETURNING key`, [key]);
    // Muted keys clear state silently (no recovery ping) so a flapping muted
    // alert can't sneak its green "recovered" message through.
    if (!MUTED.has(key) && rows.length > 0 && recoveryText) await notifySlack(recoveryText);
  } catch {
    /* best-effort */
  }
}

export async function GET(req: NextRequest) {
  // Optional shared-secret guard (Vercel cron sends it when CRON_SECRET is set).
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getBolticClient();
  const fired: string[] = [];

  // 1) LIVE DATA PIPELINE — best-of-2 authenticated probe through the relay +
  //    cookie. web_profile_info flaps 400/empty on a single throttled egress IP,
  //    so a lone failure isn't actionable — retry once before alerting.
  let status = -1; // last HTTP status seen (-1 = never got a response = relay down)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    try {
      const res = await igFetch(PROBE, { headers: PROBE_HEADERS });
      status = res.status;
      if (res.ok) break; // clean success → stop
      if (res.status === 401 || res.status === 403) break; // hard auth fail → no retry
      // 400 / 429 / 5xx → transient, retry once
    } catch {
      status = -1; // igFetch threw → relay/tunnel unreachable from the cloud
    }
  }
  if (status >= 200 && status < 300) {
    await clearAlert('live_cookie', ':white_check_mark: Live data flowing again — cookie/relay recovered.');
    await clearAlert('live_relay', ':white_check_mark: Relay reachable again — live data flowing.');
    await clearAlert('live_ratelimit');
    await clearAlert('live_http');
  } else if (status === 401 || status === 403) {
    fired.push('cookie_dead');
    await alertOnce('live_cookie', `:red_circle: *Live cookie rejected* (HTTP ${status}) — every IG session cookie is being refused. Live posts/engagement are down. Revive an account (\`npm run scraper:capture -- <handle>\`).`);
  } else if (status === 400 || status === 429) {
    // IG returns 400 (not just 429) as a soft anti-bot throttle on this endpoint
    // when one egress IP hits it repeatedly — intermittent, self-clears.
    fired.push('rate_limited');
    await alertOnce('live_ratelimit', `:warning: *Instagram is soft-throttling (HTTP ${status})* — live data intermittent. Usually clears in 30–60 min; revive more accounts / spread egress to steady it.`);
  } else if (status > 0) {
    fired.push(`http_${status}`);
    await alertOnce('live_http', `:warning: *Live probe returned HTTP ${status}* — unexpected response from Instagram.`);
  } else {
    fired.push('relay_down');
    await alertOnce('live_relay', ':red_circle: *Relay unreachable* — the cloud app can’t reach Instagram. Is the relay + tunnel running on the crawl host? (`./run-relay.sh`)');
  }

  // 2) ACCOUNT POOL — ready count + accounts expiring soon.
  try {
    const rows = await db.query<{ ready: number; expiring: number; soon_handles: string | null }>(
      `SELECT
         count(*) FILTER (WHERE storage_state IS NOT NULL AND status='active' AND (storage_expires_at IS NULL OR storage_expires_at > now()))::int AS ready,
         count(*) FILTER (WHERE storage_expires_at > now() AND storage_expires_at < now() + interval '3 days')::int AS expiring,
         string_agg(handle, ', ') FILTER (WHERE storage_expires_at > now() AND storage_expires_at < now() + interval '3 days') AS soon_handles
       FROM service_accounts WHERE platform='instagram'`,
    );
    const ready = Number(rows[0]?.ready ?? 0);
    const expiring = Number(rows[0]?.expiring ?? 0);
    if (ready === 0) {
      fired.push('no_accounts');
      await alertOnce('acct_none', ':red_circle: *No IG accounts ready* — the whole pool is expired. Re-capture at least one (`npm run scraper:capture -- <handle>`) to restore crawling + live data.');
    } else {
      await clearAlert('acct_none', `:white_check_mark: Accounts back in rotation (${ready} ready).`);
      if (ready === 1) {
        fired.push('one_account');
        await alertOnce('acct_low', ':warning: *Only 1 IG account ready* — live data will be intermittent (single cookie throttles). Revive another to steady it.', 12 * 60);
      } else {
        await clearAlert('acct_low');
      }
    }
    if (expiring > 0) {
      fired.push('expiring_soon');
      await alertOnce('acct_expiring', `:hourglass_flowing_sand: *${expiring} account(s) expire within 3 days* (${rows[0]?.soon_handles}). Revive them soon, staggered, so the pool doesn’t collapse.`, 12 * 60);
    } else {
      await clearAlert('acct_expiring');
    }
  } catch {
    /* skip */
  }

  // 3) WORKER — heartbeat stale AND jobs STUCK = the crawl worker is down.
  //    We only count jobs queued longer than a grace window (10 min), not every
  //    freshly-enqueued one. A normal search enqueues a `search_query` job the
  //    instant it runs; a live worker claims it within seconds. Without the grace
  //    window, any search would trip this alert even though the instant results
  //    (live-discovery + OpenAI + DB) already returned fine and the worker was
  //    about to pick the job up — the "results came up but I still got pinged"
  //    false alarm. A job only counts as stalled once it's sat unworked past the
  //    window, which genuinely means nothing is draining the queue.
  const STALLED_JOB_GRACE_MIN = 10;
  try {
    const rows = await db.query<{ beat_secs: number | null; stuck: number }>(
      `SELECT
         EXTRACT(EPOCH FROM (now() - (SELECT beat_at FROM worker_heartbeat WHERE worker='main')))::int AS beat_secs,
         (SELECT count(*) FROM scrape_jobs
            WHERE status='queued'
              AND queued_at < now() - ($1 || ' minutes')::interval)::int AS stuck`,
      [String(STALLED_JOB_GRACE_MIN)],
    );
    const beat = rows[0]?.beat_secs;
    const stuck = Number(rows[0]?.stuck ?? 0);
    if ((beat == null || beat > 300) && stuck > 0) {
      fired.push('worker_stalled');
      await alertOnce('worker_stalled', `:warning: *Worker idle with ${stuck} job(s) stuck >${STALLED_JOB_GRACE_MIN}min* — the crawl worker isn’t draining the queue. Start it on the crawl host (\`./run-worker.sh\`).`);
    } else {
      await clearAlert('worker_stalled');
    }
  } catch {
    /* skip */
  }

  return NextResponse.json({ checked_at: new Date().toISOString(), alerts_fired: fired });
}
