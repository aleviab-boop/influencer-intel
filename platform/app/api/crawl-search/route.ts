import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { tokenize, type LiveProfile } from '@/lib/live-discovery';
import { searchCreatorsInDb } from '@/lib/creator-db-search';

export const runtime = 'nodejs';

// POST /api/crawl-search
//   { prompt }
//   → { job_id, prompt, tokens, results }
//
// Powers the admin Scraper page. Enqueues a `search_query` job the browser
// worker crawls (tagging finds with `search:<job_id>` for the client to poll),
// AND returns instant DB matches so the page shows relevant creators immediately
// while the live crawl streams fresh ones on top — it's never empty even if the
// worker is busy or the crawl is slow.
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
    console.error('[crawl-search] enqueue failed:', err);
  }

  const tokens = tokenize(prompt);
  let results: LiveProfile[] = [];
  try {
    results = await searchCreatorsInDb(tokens, 60);
  } catch (err) {
    console.error('[crawl-search] db search failed:', err);
  }

  return NextResponse.json({ job_id: jobId, prompt, tokens, results });
}
