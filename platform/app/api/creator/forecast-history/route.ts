import { NextResponse } from 'next/server';
import { listPredictionsForCreator } from '@/lib/reach-prediction-log';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';

/**
 * GET /api/creator/forecast-history?handle=|account=
 *
 * The logged-in creator's own forecast track record — every reel prediction we
 * logged for them, joined to any recorded actual, plus a small accuracy readout
 * (how many landed a real outcome and the typical likes error). Session-first
 * identity via resolveCreatorId (handles the ?handle/?account preview fallback).
 * Read-only, always 200.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const history = await listPredictionsForCreator(creatorId, 12);
    return NextResponse.json({ available: true, ...history });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'error', error: (err as Error).message }, { status: 200 });
  }
}
