import { NextResponse } from 'next/server';
import { scoreContent } from '@influencer-intel/shared/content-scorer';
import type { ContentScoreRequest } from '@influencer-intel/shared/types';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json() as ContentScoreRequest;
  if (!body.media_url || !body.media_type) {
    return NextResponse.json({ error: 'media_url and media_type are required' }, { status: 400 });
  }
  try {
    const result = await scoreContent(body);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[content-scorer] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
