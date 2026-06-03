import { NextResponse } from 'next/server';
import { startMonitoring, processCheckpoint } from '@/lib/monitoring-service';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json() as {
    creator_id: string;
    post_url: string;
    ig_media_id?: string;
  };

  if (!body.creator_id || !body.post_url) {
    return NextResponse.json({ error: 'creator_id and post_url are required' }, { status: 400 });
  }

  try {
    const monitored = await startMonitoring(body);
    return NextResponse.json({ monitored_post_id: monitored.id, status: 'monitoring_started' });
  } catch (err) {
    console.error('[monitor] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const postId = url.searchParams.get('post_id');
  if (!postId) {
    return NextResponse.json({ error: 'post_id query param required' }, { status: 400 });
  }

  try {
    const update = await processCheckpoint(postId);
    if (!update) {
      return NextResponse.json({ status: 'no_checkpoint_due' });
    }
    return NextResponse.json(update);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
