import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { predictReach } from '@/lib/reach-predictor';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Format = 'reel' | 'photo' | 'carousel';
const FORMATS: Format[] = ['reel', 'photo', 'carousel'];

/**
 * POST /api/predict/reach
 *
 * Predict the raw views & likes a creator's next post/reel will get, from their
 * day-to-day baseline × how trend-aligned the content is × timing.
 *
 * Body: { creator_id?, handle?, format?, caption?, hashtags?, post_time? }
 * Provide either creator_id or handle. Returns a ReachPrediction, or
 * { error } with 400/404 when the creator can't be resolved.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: {
    creator_id?: string; handle?: string; format?: string;
    caption?: string; hashtags?: string[]; post_time?: string;
    media_url?: string; thumbnail_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const format: Format = FORMATS.includes(body.format as Format) ? (body.format as Format) : 'reel';

  // Resolve creator_id — directly, or by handle lookup.
  let creatorId = body.creator_id?.trim() || '';
  if (!creatorId && body.handle) {
    try {
      const db = getBolticClient();
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM creators WHERE LOWER(handle) = LOWER($1) ORDER BY updated_at DESC LIMIT 1`,
        [body.handle.replace(/^@/, '')],
      );
      creatorId = rows[0]?.id ?? '';
    } catch (err) {
      console.error('[predict/reach] handle lookup failed:', err);
    }
  }
  if (!creatorId) {
    return NextResponse.json({ error: 'creator_id or handle is required' }, { status: 400 });
  }

  try {
    const result = await predictReach({
      creator_id: creatorId,
      format,
      caption: body.caption,
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : undefined,
      post_time: body.post_time,
      media_url: typeof body.media_url === 'string' ? body.media_url.trim() || undefined : undefined,
      thumbnail_url: typeof body.thumbnail_url === 'string' ? body.thumbnail_url.trim() || undefined : undefined,
    });
    if (!result) {
      return NextResponse.json({ error: 'not_enough_data', message: 'No post history to predict from for this creator.' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[predict/reach] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
