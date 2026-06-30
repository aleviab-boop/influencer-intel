import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { tokenize, type LiveProfile } from '@/lib/live-discovery';
import { searchCreatorsInDb } from '@/lib/creator-db-search';

export const runtime = 'nodejs';

// POST /api/crawl-search
//   { prompt }
//   → { job_id, prompt, tokens, results }
//
// Worker-backed discovery. Unlike the old synchronous /api/discover-live crawl
// (which runs inside Vercel and is throttled by IG's data-center IP blocking),
// this enqueues a `search_query` job into the shared DB. The browser worker
// running on a real machine claims it, crawls Instagram with an authenticated
// session, and tags every creator it finds with `search:<job_id>` — which the
// client then polls for via /api/crawl-search/status.
//
// We also return instant DB matches so the user sees results immediately while
// the live worker crawl streams in behind them.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 2) {
    return NextResponse.json({ error: 'prompt must be at least 2 characters' }, { status: 400 });
  }

  const db = getBolticClient();

  // Enqueue a worker search_query job. priority 1 so it preempts background
  // refresh work and is claimed promptly by the orchestrator.
  let jobId: string | null = null;
  try {
    const job = await db.insert<{ id: string }>('scrape_jobs', {
      job_type: 'search_query',
      target_platform: 'instagram',
      target_handle: prompt,
      priority: 1,
      status: 'queued',
      attempts: 0,
      queued_at: new Date().toISOString(),
    });
    jobId = job.id;
  } catch (err) {
    // Enqueue failed (DB hiccup) — still return DB results so the UI isn't empty.
    console.error('[crawl-search] enqueue failed:', err);
  }

  // Instant DB matches so the user sees something immediately.
  const tokens = tokenize(prompt);
  let results: LiveProfile[] = [];
  try {
    results = await searchCreatorsInDb(tokens, 60);
  } catch (err) {
    console.error('[crawl-search] db search failed:', err);
  }

  return NextResponse.json({ job_id: jobId, prompt, tokens, results });
}
