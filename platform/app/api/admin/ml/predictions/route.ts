import { NextResponse, type NextRequest } from 'next/server';
import { listRecentPredictions } from '@/lib/reach-prediction-log';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ml/predictions?limit=25
 *
 * Recent reach forecasts (newest first), each joined to the actual it was
 * scored against (if any). Powers the "Recent forecasts" ledger on the admin ML
 * panel. Gated by the admin middleware. Read-only; safe when empty.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = Number(new URL(req.url).searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 25;
  try {
    const predictions = await listRecentPredictions(limit);
    return NextResponse.json({ predictions });
  } catch (err) {
    console.error('[ml/predictions] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
