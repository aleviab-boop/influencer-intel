import { NextResponse } from 'next/server';
import { computeModelLift } from '@/lib/model-vs-baseline';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ml/lift
 *
 * "Is the model earning its keep?" — over every forecast with a recorded
 * actual, compares the full prediction's error against the raw baseline's error
 * on the same post (median error, win-rate, improvement). Gated by the admin
 * middleware. Read-only; blank until forecasts are scored against actuals.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const lift = await computeModelLift();
    return NextResponse.json(lift);
  } catch (err) {
    console.error('[ml/lift] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
