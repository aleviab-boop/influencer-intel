import { NextResponse } from 'next/server';
import { computeReachModelStaleness } from '@/lib/model-staleness';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ml/staleness
 *
 * "Is it worth retraining right now?" — how much new training signal (vision
 * content scores, OAuth post insights) and how many recorded outcomes have
 * accumulated since the reach model was last fit, with a stale/up-to-date
 * recommendation. Gated by the admin middleware. Read-only.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const staleness = await computeReachModelStaleness();
    return NextResponse.json(staleness);
  } catch (err) {
    console.error('[ml/staleness] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
