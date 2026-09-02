import { NextRequest, NextResponse } from 'next/server';
import { backfillViaApify, backfillCandidateCount } from '@/lib/apify-backfill';

export const runtime = 'nodejs';
export const maxDuration = 300; // batches of Apify runs can take minutes

// GET  /api/admin/backfill
//   How many creators currently need enrichment (thin shells: no posts / no
//   follower count). Cheap pre-check for the admin UI — no Apify spend.
export async function GET(): Promise<NextResponse> {
  try {
    const candidates = await backfillCandidateCount();
    const hasToken = Boolean(process.env.APIFY_TOKEN);
    return NextResponse.json({ candidates, hasToken });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/admin/backfill   { limit?, batchSize? }
//   PAID. Runs the biggest under-populated creators through Apify in batches
//   (one billed run per batch) and writes reach/engagement/posts back. Bounded
//   by `limit` (clamped 1..300 in the lib) so the bill is predictable
//   (~$0.50 / 1k profiles). Returns a BackfillReport. Never throws per-creator.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!process.env.APIFY_TOKEN) {
    return NextResponse.json(
      { error: 'APIFY_TOKEN not configured — backfill is a no-op without it.' },
      { status: 400 },
    );
  }
  let body: { limit?: number; batchSize?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → defaults */
  }
  try {
    const report = await backfillViaApify({
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      batchSize: typeof body.batchSize === 'number' ? body.batchSize : undefined,
    });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
