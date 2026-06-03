import { NextResponse } from 'next/server';
import { predictContentPerformance } from '@/lib/prediction-engine';
import type { ContentScores } from '@influencer-intel/shared/types';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json() as {
    creator_id: string;
    content_scores?: ContentScores;
    target_post_time?: string;
  };

  if (!body.creator_id) {
    return NextResponse.json({ error: 'creator_id is required' }, { status: 400 });
  }

  try {
    const result = await predictContentPerformance(body);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[predict] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
