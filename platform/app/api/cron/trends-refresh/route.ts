import { NextRequest, NextResponse } from 'next/server';
import { ingestTrendSignals } from '@/lib/trend-ingest';

export const runtime = 'nodejs';
export const maxDuration = 120; // scanning post history across creators is slow

/**
 * GET /api/cron/trends-refresh
 *
 * Daily job that re-derives hashtag + format trend signals from our own crawl
 * data (recent_posts) and upserts them into trend_signals — so /api/trends, the
 * prediction engine and the brand campaign-ideas grounding all read fresh, first-
 * party trends without anyone hitting the admin endpoint by hand. Idempotent
 * (upserts on trend_type+identifier), so re-running is safe. Optional CRON_SECRET
 * guard (Vercel cron sends it as a Bearer token).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const report = await ingestTrendSignals();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[cron] trends-refresh failed:', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
