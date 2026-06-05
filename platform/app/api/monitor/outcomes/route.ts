import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { Creator, PostOutcome } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

// GET /api/monitor/outcomes?creator_id=...  → recorded outcomes (newest first)
export async function GET(req: NextRequest) {
  const creatorId = new URL(req.url).searchParams.get('creator_id');
  if (!creatorId) {
    return NextResponse.json({ error: 'creator_id query param is required' }, { status: 400 });
  }
  try {
    const db = getBolticClient();
    const outcomes = await db.query<PostOutcome>(
      `SELECT * FROM post_outcomes WHERE creator_id = $1 ORDER BY created_at ASC`,
      [creatorId],
    );
    return NextResponse.json({ outcomes });
  } catch (err) {
    console.error('[outcomes] list failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/monitor/outcomes
//   { creator_id, program_id?, post_url?, posted_at?,
//     predicted_er?, predicted_likes?, predicted_views?,
//     actual_likes, actual_comments?, actual_views?, note? }
//   → record a real post result (with the prediction snapshot for comparison)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.creator_id !== 'string') {
    return NextResponse.json({ error: 'creator_id is required' }, { status: 400 });
  }
  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  try {
    const db = getBolticClient();
    const creator = await db.findById<Creator>('creators', body.creator_id);
    if (!creator) return NextResponse.json({ error: 'creator not found' }, { status: 404 });

    const actualLikes = numOrNull(body.actual_likes);
    const actualComments = numOrNull(body.actual_comments);
    // Coerce follower_count (pg may return numeric as string).
    const followers = Number(creator.follower_count);
    const actualEr =
      Number.isFinite(followers) && followers > 0 && actualLikes !== null
        ? (actualLikes + (actualComments ?? 0)) / followers
        : null;

    const outcome = await db.insert<PostOutcome>('post_outcomes', {
      creator_id: body.creator_id,
      program_id: typeof body.program_id === 'string' ? body.program_id : null,
      post_url: typeof body.post_url === 'string' ? body.post_url : null,
      posted_at: typeof body.posted_at === 'string' ? body.posted_at : null,
      predicted_er: numOrNull(body.predicted_er),
      predicted_likes: numOrNull(body.predicted_likes),
      predicted_views: numOrNull(body.predicted_views),
      actual_likes: actualLikes,
      actual_comments: actualComments,
      actual_views: numOrNull(body.actual_views),
      actual_er: actualEr,
      note: typeof body.note === 'string' ? body.note : null,
    });

    return NextResponse.json({ outcome });
  } catch (err) {
    console.error('[outcomes] record failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
