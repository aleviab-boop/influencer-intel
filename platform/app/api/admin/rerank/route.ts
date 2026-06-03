// ============================================================
// Admin: force a re-rank of a brief without waiting for a callback.
// Used when callbacks were silently failing (e.g. webpack cache served
// a 500 for the past 30 minutes) — kicks the rerank loop manually.
//
// POST /api/admin/rerank  body: { brief_id: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { reRankAfterScrape } from '@/lib/shortlist-service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { brief_id?: string } | null;
  if (!body?.brief_id) return NextResponse.json({ error: 'brief_id required' }, { status: 400 });
  try {
    await reRankAfterScrape({ brief_id: body.brief_id, newly_scraped_creator_id: null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
