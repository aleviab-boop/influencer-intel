import { NextResponse, type NextRequest } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { Creator } from '@influencer-intel/shared/types';
import { fetchPostMetricsByUrl } from '@/lib/post-metrics';

export const runtime = 'nodejs';
export const maxDuration = 30; // one live scrape

/**
 * POST /api/monitor/outcomes/enrich
 *
 * Best-effort auto-fill for the "record actual result" form: given a creator
 * and a post URL, resolve the post's current likes/comments/views via a live
 * profile scrape so the numbers don't have to be typed in. Body:
 *   { creator_id?, handle?, post_url }
 * Returns LivePostMetrics ({ found: false, ... } when it can't be resolved).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const postUrl = typeof body?.post_url === 'string' ? body.post_url.trim() : '';
  if (!postUrl) {
    return NextResponse.json({ error: 'post_url is required' }, { status: 400 });
  }

  // Resolve the handle — directly, or from the creator record.
  let handle = typeof body?.handle === 'string' ? body.handle.trim() : '';
  if (!handle && typeof body?.creator_id === 'string') {
    try {
      const creator = await getBolticClient().findById<Creator>('creators', body.creator_id);
      handle = (creator?.handle ?? '').trim();
    } catch { /* fall through → no handle */ }
  }
  if (!handle) {
    return NextResponse.json({ error: 'creator_id or handle is required' }, { status: 400 });
  }

  try {
    const metrics = await fetchPostMetricsByUrl(handle, postUrl);
    return NextResponse.json(metrics);
  } catch (err) {
    console.error('[outcomes/enrich] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
