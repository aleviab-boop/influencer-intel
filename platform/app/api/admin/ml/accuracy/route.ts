import { NextResponse } from 'next/server';
import { computeForecastAccuracy } from '@/lib/forecast-accuracy';
import { loadReachCalibration } from '@/lib/reach-calibration';

export const runtime = 'nodejs';

const FORMATS = ['reel', 'photo', 'carousel'] as const;

/**
 * GET /api/admin/ml/accuracy
 *
 * Forecast-vs-actual scoreboard: reads the post_outcomes log and reports how
 * close the reach predictor's predictions were to reality (median % error,
 * bias, hit-rate) for likes, views and ER — overall and per format — plus the
 * self-calibration correction currently in effect for each format. Gated by
 * the admin middleware. Read-only; safe when the log is empty.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const accuracy = await computeForecastAccuracy();
    // The live correction each format's next forecast will get.
    const calibrations = await Promise.all(FORMATS.map((f) => loadReachCalibration(f)));
    return NextResponse.json({ ...accuracy, calibrations });
  } catch (err) {
    console.error('[ml/accuracy] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
