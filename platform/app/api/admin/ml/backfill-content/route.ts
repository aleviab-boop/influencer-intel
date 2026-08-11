import { NextResponse, type NextRequest } from 'next/server';
import { backfillContentScores, contentScoreCoverage } from '@/lib/ml/content-backfill';

export const runtime = 'nodejs';
export const maxDuration = 300; // vision scoring is I/O-bound; allow a batch to run

/**
 * POST /api/admin/ml/backfill-content
 *
 * Score a bounded batch of not-yet-scored historical posts with gpt-4o vision
 * and cache the results in post_content_scores, so the next reach retrain can
 * learn a content-quality effect. Body: { limit?: number } (default 25, max
 * 500). Gated by the admin middleware. Idempotent & resumable — call repeatedly
 * in small batches to grow coverage without a huge one-shot cost.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let limit = 25;
    try {
      const body = await req.json();
      if (body && typeof body.limit === 'number' && Number.isFinite(body.limit)) limit = body.limit;
    } catch { /* no/invalid body → default */ }
    const report = await backfillContentScores({ limit });
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[ml/backfill-content] error:', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/admin/ml/backfill-content
 *
 * Read-only coverage snapshot: how many posts already carry a cached content
 * score. Does not score anything.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const coverage = await contentScoreCoverage();
    return NextResponse.json({ ok: true, ...coverage });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
