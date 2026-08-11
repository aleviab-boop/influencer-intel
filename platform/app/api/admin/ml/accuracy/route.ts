import { NextResponse } from 'next/server';
import { computeForecastAccuracy } from '@/lib/forecast-accuracy';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ml/accuracy
 *
 * Forecast-vs-actual scoreboard: reads the post_outcomes log and reports how
 * close the reach predictor's predictions were to reality (median % error,
 * bias, hit-rate) for likes, views and ER. Gated by the admin middleware.
 * Read-only; safe when the log is empty (returns zeroed metrics).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const accuracy = await computeForecastAccuracy();
    return NextResponse.json(accuracy);
  } catch (err) {
    console.error('[ml/accuracy] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
