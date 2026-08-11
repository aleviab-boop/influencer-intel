import { computeForecastAccuracy } from './forecast-accuracy';

// ── Self-calibration ───────────────────────────────────────────────────────
// As real post results accumulate in post_outcomes, the forecast-vs-actual
// scoreboard reveals systematic bias (e.g. "we over-predict likes by +20%").
// This turns that bias into a bounded correction applied to future forecasts,
// so the predictor self-corrects as evidence builds — without ever letting a
// handful of early points swing predictions wildly.

// Below this many scored outcomes we don't trust the bias — correction stays 1.
const MIN_SAMPLES = 8;
// A correction can only nudge a prediction within this band, so even a strong
// early bias can't distort forecasts more than ±30%.
const CORRECTION_LO = 0.7;
const CORRECTION_HI = 1.43;
const CACHE_MS = 5 * 60_000;

export interface ReachCalibration {
  applied: boolean;            // at least one correction ≠ 1 is in effect
  likes_correction: number;    // multiply predicted likes by this
  views_correction: number;    // multiply predicted views by this
  n_outcomes: number;          // scored outcomes the correction is based on
}

const NEUTRAL: ReachCalibration = {
  applied: false, likes_correction: 1, views_correction: 1, n_outcomes: 0,
};

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

// Turn a signed median bias (predicted/actual − 1) into a correction that
// cancels it: if we over-predict by +20% (bias 0.2), scale by 1/1.2 ≈ 0.83.
function correctionFromBias(bias: number | null, n: number): number {
  if (bias == null || n < MIN_SAMPLES) return 1;
  return clamp(1 / (1 + bias), CORRECTION_LO, CORRECTION_HI);
}

let cache: { at: number; value: ReachCalibration } | null = null;

/**
 * Load the current reach calibration, derived from recorded outcomes. Cached
 * for 5 minutes. Never throws — returns a neutral (no-op) calibration when
 * there aren't enough outcomes or the log can't be read.
 */
export async function loadReachCalibration(): Promise<ReachCalibration> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const acc = await computeForecastAccuracy();
    const likes = correctionFromBias(acc.likes.median_bias, acc.likes.n);
    const views = correctionFromBias(acc.views.median_bias, acc.views.n);
    const value: ReachCalibration = {
      applied: likes !== 1 || views !== 1,
      likes_correction: Math.round(likes * 1000) / 1000,
      views_correction: Math.round(views * 1000) / 1000,
      n_outcomes: Math.max(acc.likes.n, acc.views.n),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return NEUTRAL;
  }
}
