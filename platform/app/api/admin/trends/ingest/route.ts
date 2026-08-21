import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { ingestTrendSignals } from '@/lib/trend-ingest';

export const runtime = 'nodejs';
export const maxDuration = 120; // scanning post history across creators is slow

/**
 * POST /api/admin/trends/ingest
 *   { creatorLimit?, windowDays?, minCount? }
 *
 * Recompute hashtag + format trend signals from our own crawl data and upsert
 * them into trend_signals. Gated by the admin middleware. Idempotent.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  try {
    const report = await ingestTrendSignals({
      creatorLimit: typeof body?.creatorLimit === 'number' ? body.creatorLimit : undefined,
      windowDays: typeof body?.windowDays === 'number' ? body.windowDays : undefined,
      minCount: typeof body?.minCount === 'number' ? body.minCount : undefined,
      withVisual: body?.withVisual === true,
      visualBudget: typeof body?.visualBudget === 'number' ? body.visualBudget : undefined,
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[admin/trends/ingest] error:', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/admin/trends/ingest
 *
 * Read-only snapshot of the current trend_signals table: totals by phase/type,
 * top movers and when it was last refreshed. Does not ingest.
 */
export async function GET(): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const [totals, byPhase, top, last] = await Promise.all([
      db.query<{ trend_type: string; n: string }>(
        `SELECT trend_type, COUNT(*)::text AS n FROM trend_signals GROUP BY trend_type`,
      ),
      db.query<{ phase: string; n: string }>(
        `SELECT phase, COUNT(*)::text AS n FROM trend_signals GROUP BY phase`,
      ),
      db.query<{ trend_type: string; display_name: string; phase: string; velocity: string; usage_count_7d: number }>(
        `SELECT trend_type, display_name, phase, velocity::text AS velocity, usage_count_7d
           FROM trend_signals
          WHERE phase IN ('emerging','growing')
          ORDER BY velocity DESC
          LIMIT 15`,
      ),
      db.query<{ updated_at: string | null }>(
        `SELECT MAX(updated_at)::text AS updated_at FROM trend_signals`,
      ),
    ]);
    return NextResponse.json({
      by_type: totals.map((r) => ({ trend_type: r.trend_type, count: Number(r.n) })),
      by_phase: byPhase.map((r) => ({ phase: r.phase, count: Number(r.n) })),
      top_movers: top.map((r) => ({
        trend_type: r.trend_type,
        display_name: r.display_name,
        phase: r.phase,
        velocity: Number(r.velocity),
        usage_count_7d: Number(r.usage_count_7d) || 0,
      })),
      last_updated: last[0]?.updated_at ?? null,
    });
  } catch {
    // Table not created yet → nothing ingested.
    return NextResponse.json({ by_type: [], by_phase: [], top_movers: [], last_updated: null });
  }
}
