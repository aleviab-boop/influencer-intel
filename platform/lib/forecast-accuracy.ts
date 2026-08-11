import { getBolticClient } from '@influencer-intel/shared/db';

// ── Forecast-vs-actual accuracy ────────────────────────────────────────────
// Reads the post_outcomes log (a prediction snapshot recorded alongside the
// real result of a post) and measures how well the reach predictor actually
// did. This is the honest scoreboard for the model — it makes no claims, it
// just compares what we predicted to what happened.

export interface MetricAccuracy {
  n: number;                    // pairs with both a prediction and an actual
  median_ape: number | null;    // median absolute % error, 0..1 (lower is better)
  median_bias: number | null;   // median signed (predicted/actual − 1): + = over-predicts
  within_25pct: number | null;  // fraction whose prediction landed within ±25%
  within_50pct: number | null;  // fraction within ±50%
}

export interface FormatAccuracy {
  likes: MetricAccuracy;
  views: MetricAccuracy;
}

export interface ForecastAccuracy {
  total_outcomes: number;       // rows in the log
  scored_outcomes: number;      // rows usable for at least one metric
  likes: MetricAccuracy;
  views: MetricAccuracy;
  er: MetricAccuracy;
  // Per-format breakdown (reel / photo / carousel), for format-specific
  // calibration. Only formats that appear in the log are present.
  by_format: Record<string, FormatAccuracy>;
  last_recorded_at: string | null;
}

interface OutcomeRow {
  predicted_likes: number | string | null;
  predicted_views: number | string | null;
  predicted_er: number | string | null;
  actual_likes: number | string | null;
  actual_views: number | string | null;
  actual_er: number | string | null;
  format: string | null;
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

// Build a single metric's accuracy from paired (predicted, actual) values,
// keeping only pairs where the actual is a positive finite number.
function metricAccuracy(pairs: Array<{ predicted: number | null; actual: number | null }>): MetricAccuracy {
  const apes: number[] = [];
  const biases: number[] = [];
  for (const { predicted, actual } of pairs) {
    if (predicted == null || actual == null || actual <= 0) continue;
    apes.push(Math.abs(predicted - actual) / actual);
    biases.push(predicted / actual - 1);
  }
  const n = apes.length;
  const within = (t: number): number | null =>
    n === 0 ? null : apes.filter((a) => a <= t).length / n;
  return {
    n,
    median_ape: median(apes),
    median_bias: median(biases),
    within_25pct: within(0.25),
    within_50pct: within(0.5),
  };
}

/**
 * Compute forecast-vs-actual accuracy over the whole post_outcomes log.
 * Returns zeroed metrics (never throws) when the table is missing or empty, so
 * the admin panel can render "no data yet" cleanly.
 */
export async function computeForecastAccuracy(): Promise<ForecastAccuracy> {
  const empty: MetricAccuracy = { n: 0, median_ape: null, median_bias: null, within_25pct: null, within_50pct: null };
  const blank: ForecastAccuracy = {
    total_outcomes: 0, scored_outcomes: 0, likes: empty, views: empty, er: empty, by_format: {}, last_recorded_at: null,
  };

  const likesViews = (rs: OutcomeRow[]): FormatAccuracy => ({
    likes: metricAccuracy(rs.map((r) => ({ predicted: num(r.predicted_likes), actual: num(r.actual_likes) }))),
    views: metricAccuracy(rs.map((r) => ({ predicted: num(r.predicted_views), actual: num(r.actual_views) }))),
  });

  try {
    const db = getBolticClient();
    const rows = await db.query<OutcomeRow>(
      `SELECT predicted_likes, predicted_views, predicted_er,
              actual_likes, actual_views, actual_er, format, created_at
         FROM post_outcomes`,
    );
    if (rows.length === 0) return blank;

    const likes = metricAccuracy(rows.map((r) => ({ predicted: num(r.predicted_likes), actual: num(r.actual_likes) })));
    const views = metricAccuracy(rows.map((r) => ({ predicted: num(r.predicted_views), actual: num(r.actual_views) })));
    const er = metricAccuracy(rows.map((r) => ({ predicted: num(r.predicted_er), actual: num(r.actual_er) })));

    const byFormat: Record<string, FormatAccuracy> = {};
    for (const fmt of ['reel', 'photo', 'carousel']) {
      const rs = rows.filter((r) => r.format === fmt);
      if (rs.length > 0) byFormat[fmt] = likesViews(rs);
    }

    const scored = rows.filter((r) =>
      (num(r.predicted_likes) != null && num(r.actual_likes) != null) ||
      (num(r.predicted_views) != null && num(r.actual_views) != null) ||
      (num(r.predicted_er) != null && num(r.actual_er) != null),
    ).length;

    const lastRecorded = rows
      .map((r) => r.created_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    return { total_outcomes: rows.length, scored_outcomes: scored, likes, views, er, by_format: byFormat, last_recorded_at: lastRecorded };
  } catch {
    // Table not created yet → no outcomes.
    return blank;
  }
}
