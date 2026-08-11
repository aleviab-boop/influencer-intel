import { computeForecastAccuracy, type ForecastAccuracy, type MetricAccuracy } from './forecast-accuracy';

// ── Self-calibration ───────────────────────────────────────────────────────
// As real post results accumulate in post_outcomes, the forecast-vs-actual
// scoreboard reveals systematic bias (e.g. "we over-predict reel likes by
// +20%"). This turns that bias into a bounded correction applied to future
// forecasts, so the predictor self-corrects as evidence builds.
//
// Calibration is per-FORMAT when a format has enough of its own outcomes (reels
// and photos carry different bias), and falls back to a pooled global
// correction otherwise — never letting a handful of early points swing things.

// Below this many scored outcomes we don't trust the bias — correction stays 1.
const MIN_SAMPLES = 8;
// A correction can only nudge a prediction within this band, so even a strong
// early bias can't distort forecasts more than ±30%.
const CORRECTION_LO = 0.7;
const CORRECTION_HI = 1.43;
const CACHE_MS = 5 * 60_000;

export type CalibrationScope = 'format' | 'global' | 'none';

export interface ReachCalibration {
  applied: boolean;            // at least one correction ≠ 1 is in effect
  scope: CalibrationScope;     // was it drawn from format-specific or pooled data
  format: string | null;       // the format this calibration is for
  likes_correction: number;    // multiply predicted likes by this
  views_correction: number;    // multiply predicted views by this
  n_outcomes: number;          // scored outcomes the correction is based on
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

// Turn a signed median bias (predicted/actual − 1) into a correction that
// cancels it: if we over-predict by +20% (bias 0.2), scale by 1/1.2 ≈ 0.83.
function correctionFromBias(bias: number | null): number {
  if (bias == null) return 1;
  return clamp(1 / (1 + bias), CORRECTION_LO, CORRECTION_HI);
}

// Resolve one metric's correction, preferring format-specific evidence over the
// pooled global figure, and reporting where the number came from.
function resolveMetric(
  formatM: MetricAccuracy | undefined,
  globalM: MetricAccuracy,
): { correction: number; source: CalibrationScope; n: number } {
  if (formatM && formatM.n >= MIN_SAMPLES) {
    return { correction: correctionFromBias(formatM.median_bias), source: 'format', n: formatM.n };
  }
  if (globalM.n >= MIN_SAMPLES) {
    return { correction: correctionFromBias(globalM.median_bias), source: 'global', n: globalM.n };
  }
  return { correction: 1, source: 'none', n: formatM?.n ?? globalM.n };
}

let cache: { at: number; acc: ForecastAccuracy } | null = null;

async function getAccuracy(): Promise<ForecastAccuracy> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.acc;
  const acc = await computeForecastAccuracy();
  cache = { at: Date.now(), acc };
  return acc;
}

/**
 * Load the current reach calibration for a given format, derived from recorded
 * outcomes. Cached for 5 minutes. Never throws — returns a neutral (no-op)
 * calibration when there aren't enough outcomes or the log can't be read.
 */
export async function loadReachCalibration(format?: string): Promise<ReachCalibration> {
  const neutral: ReachCalibration = {
    applied: false, scope: 'none', format: format ?? null,
    likes_correction: 1, views_correction: 1, n_outcomes: 0,
  };
  try {
    const acc = await getAccuracy();
    const fmt = format ? acc.by_format[format] : undefined;

    const likes = resolveMetric(fmt?.likes, acc.likes);
    const views = resolveMetric(fmt?.views, acc.views);

    // The overall scope is the stronger of the two metrics' sources.
    const scope: CalibrationScope =
      likes.source === 'format' || views.source === 'format' ? 'format'
      : likes.source === 'global' || views.source === 'global' ? 'global'
      : 'none';

    return {
      applied: likes.correction !== 1 || views.correction !== 1,
      scope,
      format: format ?? null,
      likes_correction: Math.round(likes.correction * 1000) / 1000,
      views_correction: Math.round(views.correction * 1000) / 1000,
      n_outcomes: Math.max(likes.n, views.n),
    };
  } catch {
    return neutral;
  }
}
