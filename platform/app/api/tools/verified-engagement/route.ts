import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedEngagement } from '@/lib/verified-metrics';

export const runtime = 'nodejs';

// GET /api/tools/verified-engagement?handle=foo
// Reach-based engagement from OAuth-synced insights, or { verified: false }
// when the creator hasn't connected / synced.
export async function GET(req: NextRequest) {
  const handle = (new URL(req.url).searchParams.get('handle') ?? '').trim();
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  try {
    const v = await getVerifiedEngagement(handle);
    return NextResponse.json(v ? { verified: true, ...v } : { verified: false });
  } catch (err) {
    console.error('[verified-engagement] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
