// ============================================================
// Reach-model staleness — "is it worth retraining right now?"
//
// The reach model is fit from scraped post history, OAuth post insights, and
// per-post vision content scores. Between trainings, more of each of those
// accumulates. This measures how much NEW training signal has landed since the
// model was last fit, plus how many ground-truth outcomes have been recorded
// since — so the admin panel can nudge a retrain instead of guessing.
//
// Read-only and best-effort: any missing table simply contributes zero, and the
// whole thing degrades to "never trained" rather than throwing.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

export interface ReachModelStaleness {
  trained: boolean;
  trained_at: string | null;
  days_since_trained: number | null;
  // New training signal accrued since the last fit.
  new_content_scores: number; // vision scores added since trained_at
  new_post_insights: number;  // OAuth posts fetched since trained_at
  new_outcomes: number;       // ground-truth actuals recorded since trained_at
  stale: boolean;             // recommendation: retraining is likely worthwhile
  reason: string;             // one-line human explanation of the recommendation
}

const FRESH: ReachModelStaleness = {
  trained: false, trained_at: null, days_since_trained: null,
  new_content_scores: 0, new_post_insights: 0, new_outcomes: 0,
  stale: false, reason: 'Model has not been trained yet — train it to start forecasting.',
};

// How much new signal / age justifies a retrain nudge.
const STALE_DAYS = 30;
const STALE_NEW_ROWS = 25; // combined new content scores + insights

async function countSince(sql: string, since: string): Promise<number> {
  try {
    const rows = await getBolticClient().query<{ n: number | string }>(sql, [since]);
    return rows.length > 0 ? Number(rows[0]!.n) || 0 : 0;
  } catch {
    return 0; // table absent → no new rows
  }
}

export async function computeReachModelStaleness(): Promise<ReachModelStaleness> {
  const db = getBolticClient();

  // Oldest of the two sub-models sets the effective "last trained" — a retrain
  // refits both, so we nudge off whichever is more out of date.
  let trainedAt: string | null = null;
  try {
    const rows = await db.query<{ trained_at: string }>(
      `SELECT trained_at FROM ml_reach_weights WHERE id IN ('likes','views') ORDER BY trained_at ASC LIMIT 1`,
    );
    trainedAt = rows.length > 0 ? rows[0]!.trained_at : null;
  } catch {
    trainedAt = null;
  }
  if (!trainedAt) return FRESH;

  const [newContentScores, newInsights, newOutcomes] = await Promise.all([
    countSince(`SELECT count(*)::int AS n FROM post_content_scores WHERE scored_at > $1`, trainedAt),
    countSince(`SELECT count(*)::int AS n FROM post_insights WHERE fetched_at > $1`, trainedAt),
    countSince(`SELECT count(*)::int AS n FROM post_outcomes WHERE created_at > $1`, trainedAt),
  ]);

  const days = Math.floor((Date.now() - new Date(trainedAt).getTime()) / 86_400_000);
  const newRows = newContentScores + newInsights;
  const stale = days >= STALE_DAYS || newRows >= STALE_NEW_ROWS;

  let reason: string;
  if (newRows >= STALE_NEW_ROWS) {
    reason = `${newRows.toLocaleString()} new training rows since the last fit — retrain to fold them in.`;
  } else if (days >= STALE_DAYS) {
    reason = `Last trained ${days} days ago — refresh to pick up newer post history.`;
  } else {
    reason = `Up to date — ${newRows.toLocaleString()} new rows in ${days} day${days === 1 ? '' : 's'}, no retrain needed.`;
  }

  return {
    trained: true,
    trained_at: trainedAt,
    days_since_trained: days,
    new_content_scores: newContentScores,
    new_post_insights: newInsights,
    new_outcomes: newOutcomes,
    stale,
    reason,
  };
}
