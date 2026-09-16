import { NextRequest, NextResponse } from 'next/server';
import { backfillEngagement, engagementCandidateCount } from '@/lib/engagement-fetcher';
import { runOgProxyCanary, readOgProxyHealth } from '@/lib/og-proxy-health';

// Only shout about a proxy outage after it's been failing for this long — a
// momentary tunnel churn self-heals within minutes, so we don't want to cry wolf
// on a single blip. Past this, the failure is real and worth a log line.
const STALE_ALERT_MINUTES = 180;

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/engagement-fetch?limit=25
//   Background engagement backfill via the FREE og-proxy path. Fills the ~70% of
//   creator rows that have no avg likes/comments or engagement rate — WITHOUT
//   touching the throttle-prone web_profile_info endpoint or spending Apify
//   credits. Because it uses the cookieless public og: pages, it needs none of
//   the account-pool / live-cooldown gates that /api/cron/enrich does; it can run
//   continuously without competing with live search.
//
//   Bounded by `limit` (default 25, max 200) so one run stays within maxDuration.
//   Triggered by a daily Vercel cron, and can be hit more often by the on-host
//   relay keeper (same pattern as /api/cron/enrich).
//
//   Auth: when CRON_SECRET is set, requires `Authorization: Bearer <secret>`.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 25;

  try {
    // Smoke-detector: one free canary fetch confirms the home-IP og proxy is
    // actually serving IG data before (and even when there's nothing to) backfill.
    const canary = await runOgProxyCanary();
    if (!canary.ok) {
      // Proxy looks down for THIS run. Only escalate to an error log once it's
      // been dark for a while (transient churns self-heal), so the signal is real.
      const health = await readOgProxyHealth();
      if (health.minutes_stale == null || health.minutes_stale >= STALE_ALERT_MINUTES) {
        console.error(
          `[engagement-fetch] og proxy DOWN — last OK ${health.last_ok_at ?? 'never'} (${health.minutes_stale ?? '∞'} min stale). Backfill skipped; check the home-IP relay/tunnel.`,
        );
      }
      // Skip the backfill entirely: with a dead proxy every fetch would fail and
      // just churn last_scraped_at on real rows for nothing.
      return NextResponse.json({ skipped: 'og_proxy_down', canary, health });
    }

    const remaining = await engagementCandidateCount();
    if (remaining === 0) {
      return NextResponse.json({ remaining: 0, canary, ...emptyReport() });
    }
    const report = await backfillEngagement({ limit });
    return NextResponse.json({ remaining, canary, ...report });
  } catch (err) {
    console.error('[engagement-fetch] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function emptyReport() {
  return { candidates: 0, attempted: 0, resolved: 0, persisted: 0, with_engagement: 0, handles: [] };
}
