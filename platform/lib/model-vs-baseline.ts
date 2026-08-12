import { getBolticClient } from '@influencer-intel/shared/db';

// ── Model vs baseline ──────────────────────────────────────────────────────
// The forecast-accuracy board says how close predictions land. This asks the
// harder, more honest question: does the full prediction (baseline × trend ×
// timing × content × calibration) actually beat just using the creator's own
// baseline? If it doesn't, the extra machinery isn't earning its keep.
//
// It joins each recorded actual back to the forecast that produced it (via the
// reach_predictions ledger) so it can compare, on the SAME post, the
// prediction's error against the baseline's error. Naturally empty until
// forecasts are recorded against actuals — makes no claims without evidence.

export interface LiftMetric {
  n: number;                          // linked posts usable for this metric
  median_prediction_ape: number | null; // median abs % error of the full prediction
  median_baseline_ape: number | null;    // median abs % error of the raw baseline
  win_rate: number | null;            // fraction where prediction beat baseline
  improvement: number | null;         // baseline_ape − prediction_ape (median); >0 = model helps
}

export interface ModelLift {
  linked_outcomes: number;            // scored forecasts linked via prediction_id
  likes: LiftMetric;
  views: LiftMetric;
  last_recorded_at: string | null;
}

interface LiftRow {
  baseline_likes: number | string | null;
  predicted_likes: number | string | null;
  baseline_views: number | string | null;
  predicted_views: number | string | null;
  actual_likes: number | string | null;
  actual_views: number | string | null;
  created_at: string;
}

const num = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// Compare prediction vs baseline error, post by post, keeping only rows where
// both are present and the actual is a positive number.
function liftMetric(rows: Array<{ baseline: number | null; predicted: number | null; actual: number | null }>): LiftMetric {
  const predApes: number[] = [];
  const baseApes: number[] = [];
  const wins: number[] = [];
  for (const { baseline, predicted, actual } of rows) {
    if (baseline == null || predicted == null || actual == null || actual <= 0) continue;
    const bApe = Math.abs(baseline - actual) / actual;
    const pApe = Math.abs(predicted - actual) / actual;
    predApes.push(pApe);
    baseApes.push(bApe);
    wins.push(pApe < bApe ? 1 : 0);
  }
  const n = predApes.length;
  const mPred = median(predApes);
  const mBase = median(baseApes);
  return {
    n,
    median_prediction_ape: mPred,
    median_baseline_ape: mBase,
    win_rate: n === 0 ? null : wins.reduce((a, b) => a + b, 0) / n,
    improvement: mPred == null || mBase == null ? null : Math.round((mBase - mPred) * 1000) / 1000,
  };
}

/**
 * Compute how much the full prediction beats the raw baseline, over every
 * forecast that has a recorded actual linked to it. Never throws — returns a
 * blank result when the ledger/outcomes are missing or nothing is linked yet.
 */
export async function computeModelLift(): Promise<ModelLift> {
  const empty: LiftMetric = { n: 0, median_prediction_ape: null, median_baseline_ape: null, win_rate: null, improvement: null };
  const blank: ModelLift = { linked_outcomes: 0, likes: empty, views: empty, last_recorded_at: null };

  try {
    const db = getBolticClient();
    const rows = await db.query<LiftRow>(
      `SELECT rp.baseline_likes, rp.predicted_likes, rp.baseline_views, rp.predicted_views,
              o.actual_likes, o.actual_views, o.created_at
         FROM reach_predictions rp
         JOIN post_outcomes o ON o.prediction_id = rp.id
        WHERE o.actual_likes IS NOT NULL OR o.actual_views IS NOT NULL`,
    );
    if (rows.length === 0) return blank;

    const likes = liftMetric(rows.map((r) => ({
      baseline: num(r.baseline_likes), predicted: num(r.predicted_likes), actual: num(r.actual_likes),
    })));
    const views = liftMetric(rows.map((r) => ({
      baseline: num(r.baseline_views), predicted: num(r.predicted_views), actual: num(r.actual_views),
    })));

    const lastRecorded = rows.map((r) => r.created_at).filter(Boolean).sort().at(-1) ?? null;

    return { linked_outcomes: rows.length, likes, views, last_recorded_at: lastRecorded };
  } catch {
    // reach_predictions or post_outcomes missing → nothing to compare yet.
    return blank;
  }
}
