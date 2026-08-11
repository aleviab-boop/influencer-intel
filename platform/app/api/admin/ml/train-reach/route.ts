import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { trainReachModels } from '@/lib/ml/reach-model';

export const runtime = 'nodejs';
export const maxDuration = 300; // training scans the whole post history

/**
 * POST /api/admin/ml/train-reach
 *
 * (Re)train the reach model on all historical posts in the DB and persist the
 * learned weights. Gated by the admin middleware. Returns holdout RMSE/R² so we
 * can see how well it generalises. Safe to call repeatedly — it upserts.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const report = await trainReachModels();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[ml/train-reach] error:', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/admin/ml/train-reach
 *
 * Current model status: whether each model is trained, its holdout metrics, and
 * when it was last fit. Read-only; does not train.
 */
export async function GET(): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const rows = await db.query<{
      id: string; n_samples: number | string; rmse: number | string | null;
      r2: number | string | null; trained_at: string;
    }>(`SELECT id, n_samples, rmse, r2, trained_at FROM ml_reach_weights WHERE id IN ('likes','views')`);
    const models = rows.map((r) => ({
      id: r.id,
      n_samples: Number(r.n_samples) || 0,
      rmse: r.rmse != null ? Number(r.rmse) : null,
      r2: r.r2 != null ? Number(r.r2) : null,
      trained_at: r.trained_at,
    }));
    return NextResponse.json({ trained: models.length > 0, models });
  } catch {
    // Table not created yet → never trained.
    return NextResponse.json({ trained: false, models: [] });
  }
}
