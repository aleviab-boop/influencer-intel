// ============================================================
// Reach prediction ledger — persist every forecast we make, so a recorded
// actual can be linked straight back to it and a forecast history can be shown.
// All writes/reads are best-effort: a logging failure must never break a
// prediction, and a missing table simply yields an empty history.
// ============================================================

import { randomUUID } from 'node:crypto';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { ReachPrediction } from '@influencer-intel/shared/types';

/**
 * Persist a forecast and return its id (or null on failure). The id is meant to
 * ride back on the ReachPrediction so the client can attach it to the outcome
 * it later records.
 */
export async function logReachPrediction(
  creatorId: string,
  caption: string | undefined,
  p: ReachPrediction,
): Promise<string | null> {
  const id = randomUUID();
  try {
    const db = getBolticClient();
    await db.query(
      `INSERT INTO reach_predictions
         (id, creator_id, format, predicted_likes, predicted_views, predicted_comments,
          predicted_er, bucket, confidence, baseline_likes, baseline_views,
          model_trained_at, caption_preview, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())`,
      [
        id, creatorId, p.format, p.predicted_likes, p.predicted_views, p.predicted_comments,
        p.predicted_er, p.bucket, p.confidence, p.baseline_likes, p.baseline_views,
        p.model_meta?.trained_at ?? null, caption ? caption.slice(0, 140) : null,
      ],
    );
    return id;
  } catch (err) {
    console.error('[reach-prediction-log] insert failed:', err);
    return null;
  }
}

export interface LoggedPrediction {
  id: string;
  creator_id: string;
  creator_handle: string | null;
  format: string | null;
  predicted_likes: number | null;
  predicted_views: number | null;
  predicted_er: number | null;
  bucket: string | null;
  confidence: string | null;
  caption_preview: string | null;
  created_at: string;
  // Populated when an actual has been recorded against this forecast.
  scored: boolean;
  actual_likes: number | null;
  actual_views: number | null;
  likes_ape: number | null; // |predicted-actual|/actual for likes, when scored
}

// Row shape shared by the recent/creator-scoped list queries.
interface PredictionRow {
  id: string; creator_id: string; creator_handle: string | null; format: string | null;
  predicted_likes: number | string | null; predicted_views: number | string | null;
  predicted_er: number | string | null; bucket: string | null; confidence: string | null;
  caption_preview: string | null; created_at: string;
  actual_likes: number | string | null; actual_views: number | string | null;
}

function mapPredictionRow(r: PredictionRow): LoggedPrediction {
  const pLikes = r.predicted_likes != null ? Number(r.predicted_likes) : null;
  const aLikes = r.actual_likes != null ? Number(r.actual_likes) : null;
  const scored = aLikes != null;
  const likesApe = scored && pLikes != null && aLikes! > 0
    ? Math.round((Math.abs(pLikes - aLikes!) / aLikes!) * 1000) / 1000
    : null;
  return {
    id: r.id,
    creator_id: r.creator_id,
    creator_handle: r.creator_handle,
    format: r.format,
    predicted_likes: pLikes,
    predicted_views: r.predicted_views != null ? Number(r.predicted_views) : null,
    predicted_er: r.predicted_er != null ? Number(r.predicted_er) : null,
    bucket: r.bucket,
    confidence: r.confidence,
    caption_preview: r.caption_preview,
    created_at: r.created_at,
    scored,
    actual_likes: aLikes,
    actual_views: r.actual_views != null ? Number(r.actual_views) : null,
    likes_ape: likesApe,
  };
}

/**
 * List the most recent forecasts (newest first), each joined to its recorded
 * outcome (if any) so the panel can show which forecasts have been scored and
 * how close they landed. Returns [] on any error.
 */
export async function listRecentPredictions(limit = 25): Promise<LoggedPrediction[]> {
  const lim = Math.max(1, Math.min(limit, 100));
  try {
    const db = getBolticClient();
    const rows = await db.query<PredictionRow>(
      `SELECT rp.id, rp.creator_id, c.handle AS creator_handle, rp.format,
              rp.predicted_likes, rp.predicted_views, rp.predicted_er, rp.bucket,
              rp.confidence, rp.caption_preview, rp.created_at,
              o.actual_likes, o.actual_views
         FROM reach_predictions rp
         LEFT JOIN creators c ON c.id::text = rp.creator_id
         LEFT JOIN LATERAL (
           SELECT actual_likes, actual_views
             FROM post_outcomes po
            WHERE po.prediction_id = rp.id
            ORDER BY po.created_at DESC
            LIMIT 1
         ) o ON true
        ORDER BY rp.created_at DESC
        LIMIT $1`,
      [lim],
    );
    return rows.map(mapPredictionRow);
  } catch (err) {
    console.error('[reach-prediction-log] list failed:', err);
    return [];
  }
}

export interface CreatorForecastHistory {
  predictions: LoggedPrediction[];
  total: number;   // forecasts made for this creator
  scored: number;  // of those, how many have a recorded actual
  median_likes_ape: number | null; // typical likes error across scored forecasts
}

/**
 * A single creator's forecast history + a small accuracy readout, for the
 * creator-facing "how have my forecasts landed?" panel. Scoped strictly to one
 * creator_id. Returns an empty history on any error.
 */
export async function listPredictionsForCreator(
  creatorId: string,
  limit = 15,
): Promise<CreatorForecastHistory> {
  const empty: CreatorForecastHistory = { predictions: [], total: 0, scored: 0, median_likes_ape: null };
  if (!creatorId) return empty;
  const lim = Math.max(1, Math.min(limit, 50));
  try {
    const db = getBolticClient();
    const rows = await db.query<PredictionRow>(
      `SELECT rp.id, rp.creator_id, c.handle AS creator_handle, rp.format,
              rp.predicted_likes, rp.predicted_views, rp.predicted_er, rp.bucket,
              rp.confidence, rp.caption_preview, rp.created_at,
              o.actual_likes, o.actual_views
         FROM reach_predictions rp
         LEFT JOIN creators c ON c.id::text = rp.creator_id
         LEFT JOIN LATERAL (
           SELECT actual_likes, actual_views
             FROM post_outcomes po
            WHERE po.prediction_id = rp.id
            ORDER BY po.created_at DESC
            LIMIT 1
         ) o ON true
        WHERE rp.creator_id = $1
        ORDER BY rp.created_at DESC
        LIMIT $2`,
      [creatorId, lim],
    );
    const predictions = rows.map(mapPredictionRow);
    const apes = predictions.map((p) => p.likes_ape).filter((v): v is number => v != null).sort((a, b) => a - b);
    const median = apes.length > 0 ? apes[Math.floor((apes.length - 1) / 2)]! : null;
    return {
      predictions,
      total: predictions.length,
      scored: predictions.filter((p) => p.scored).length,
      median_likes_ape: median,
    };
  } catch (err) {
    console.error('[reach-prediction-log] creator list failed:', err);
    return empty;
  }
}

