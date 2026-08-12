import { NextResponse, type NextRequest } from 'next/server';
import { listPredictionsForCreator } from '@/lib/reach-prediction-log';

export const runtime = 'nodejs';

/**
 * GET /api/predict/history?creator_id=<id>&limit=15
 *
 * A single creator's forecast history + a small accuracy readout, for the
 * creator-facing "how have my forecasts landed?" panel on the predict page.
 * Scoped strictly to the requested creator_id. Read-only; safe when empty.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const creatorId = (url.searchParams.get('creator_id') ?? '').trim();
  if (!creatorId) {
    return NextResponse.json({ error: 'creator_id is required' }, { status: 400 });
  }
  const raw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 15;
  try {
    const history = await listPredictionsForCreator(creatorId, limit);
    return NextResponse.json(history);
  } catch (err) {
    console.error('[predict/history] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
