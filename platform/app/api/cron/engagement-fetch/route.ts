import { NextRequest, NextResponse } from 'next/server';
import { backfillEngagement, engagementCandidateCount } from '@/lib/engagement-fetcher';

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
    const remaining = await engagementCandidateCount();
    if (remaining === 0) {
      return NextResponse.json({ remaining: 0, ...emptyReport() });
    }
    const report = await backfillEngagement({ limit });
    return NextResponse.json({ remaining, ...report });
  } catch (err) {
    console.error('[engagement-fetch] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function emptyReport() {
  return { candidates: 0, attempted: 0, resolved: 0, persisted: 0, with_engagement: 0, handles: [] };
}
