import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { listPredictionsForCreator } from '@/lib/reach-prediction-log';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';

interface LedgerRow {
  id: string;
  format: string | null;
  predicted_likes: number | string | null;
  predicted_views: number | string | null;
  predicted_er: number | string | null;
}
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * GET /api/creator/forecast-history?handle=|account=
 *
 * The logged-in creator's own forecast track record — every reel prediction we
 * logged for them, joined to any recorded actual, plus a small accuracy readout
 * (how many landed a real outcome and the typical likes error). Session-first
 * identity via resolveCreatorId (handles the ?handle/?account preview fallback).
 * Read-only, always 200.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const history = await listPredictionsForCreator(creatorId, 12);
    return NextResponse.json({ available: true, ...history });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * POST /api/creator/forecast-history?handle=|account=
 *
 * Record the real outcome of a past forecast, closing the forecast-vs-actual
 * loop that feeds the self-calibration layer. Identity is resolved server-side
 * and the prediction MUST belong to the calling creator — the predicted
 * snapshot is read from the ledger row, never trusted from the client.
 *
 * Body: { prediction_id, actual_likes, actual_comments?, actual_views?, post_url? }
 * Always 200 on the happy path; 400 for a bad payload; 404 if the forecast
 * isn't this creator's.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const predictionId = typeof body?.prediction_id === 'string' ? body.prediction_id : '';
    const actualLikes = numOrNull(body?.actual_likes);
    if (!predictionId) return NextResponse.json({ ok: false, reason: 'no_prediction' }, { status: 400 });
    if (actualLikes === null || actualLikes < 0) return NextResponse.json({ ok: false, reason: 'bad_likes' }, { status: 400 });

    // The forecast must be this creator's — pull the predicted snapshot from it.
    const [led] = await db.query<LedgerRow>(
      `SELECT id, format, predicted_likes, predicted_views, predicted_er
         FROM reach_predictions WHERE id = $1 AND creator_id = $2 LIMIT 1`,
      [predictionId, creatorId],
    );
    if (!led) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

    const actualComments = numOrNull(body?.actual_comments);
    const [c] = await db.query<{ follower_count: number | string | null }>(
      `SELECT follower_count FROM creators WHERE id = $1 LIMIT 1`, [creatorId],
    );
    const followers = Number(c?.follower_count);
    const actualEr = Number.isFinite(followers) && followers > 0
      ? (actualLikes + (actualComments ?? 0)) / followers
      : null;

    await db.insert('post_outcomes', {
      creator_id: creatorId,
      program_id: null,
      post_url: typeof body?.post_url === 'string' ? body.post_url : null,
      posted_at: null,
      predicted_er: led.predicted_er != null ? Number(led.predicted_er) : null,
      predicted_likes: led.predicted_likes != null ? Number(led.predicted_likes) : null,
      predicted_views: led.predicted_views != null ? Number(led.predicted_views) : null,
      actual_likes: actualLikes,
      actual_comments: actualComments,
      actual_views: numOrNull(body?.actual_views),
      actual_er: actualEr,
      format: led.format,
      prediction_id: predictionId,
      note: null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'error', error: (err as Error).message }, { status: 200 });
  }
}
