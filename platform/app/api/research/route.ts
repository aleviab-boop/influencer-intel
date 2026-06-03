// ============================================================
// Bulk + single creator research — user-driven discovery path.
// Accepts a list of IG handles (or URLs) and queues priority on_demand
// scrape jobs. Used when the user manually finds creators on IG and
// wants us to extract the full 50+ field profile + vision insights.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

interface ResearchRequest {
  handles?: unknown;
  brief_id?: string | null;
}

const HANDLE_RE = /^[a-z0-9._]{1,30}$/i;

function normalizeHandle(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  // strip URL prefixes
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  // strip trailing slash + query
  s = s.split('/')[0]!.split('?')[0]!;
  // strip @
  s = s.replace(/^@/, '');
  s = s.toLowerCase();
  if (!HANDLE_RE.test(s)) return null;
  return s;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ResearchRequest | null;
  if (!body) return NextResponse.json({ error: 'invalid json' }, { status: 400 });

  const raw = body.handles;
  if (!Array.isArray(raw) && typeof raw !== 'string') {
    return NextResponse.json({ error: 'handles must be string or string[]' }, { status: 400 });
  }

  // Accept comma / newline / space separated string OR array
  const tokens = Array.isArray(raw)
    ? raw.flatMap((h) => (typeof h === 'string' ? h.split(/[\s,]+/) : []))
    : (raw as string).split(/[\s,]+/);

  const handles = Array.from(
    new Set(tokens.map(normalizeHandle).filter((h): h is string => !!h)),
  );

  if (handles.length === 0) {
    return NextResponse.json({ error: 'no valid handles' }, { status: 400 });
  }
  if (handles.length > 50) {
    return NextResponse.json({ error: 'max 50 handles per request' }, { status: 400 });
  }

  const db = getBolticClient();
  const briefId = body.brief_id ?? null;

  // Queue priority on_demand jobs. Skip handles that already have an active
  // queued/in-progress job for the same brief context.
  const queued: string[] = [];
  const skipped: string[] = [];

  for (const h of handles) {
    const dup = await db.query<{ id: string }>(
      `SELECT id FROM scrape_jobs
       WHERE target_handle = $1 AND job_type = 'on_demand'
         AND status IN ('queued','in_progress')
         AND COALESCE(brief_id::text, '') = COALESCE($2::text, '')
       LIMIT 1`,
      [h, briefId],
    );
    if (dup.length > 0) {
      skipped.push(h);
      continue;
    }
    await db.insert('scrape_jobs', {
      job_type: 'on_demand',
      target_platform: 'instagram',
      target_handle: h,
      brief_id: briefId,
      priority: 0, // top priority — user explicitly asked
      status: 'queued',
      attempts: 0,
      queued_at: new Date().toISOString(),
    });
    queued.push(h);
  }

  return NextResponse.json({ queued, skipped, total: handles.length });
}

// GET — show current state of recently-queued research jobs
export async function GET() {
  const db = getBolticClient();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT sj.id, sj.target_handle, sj.status, sj.attempts, sj.queued_at, sj.completed_at,
            sj.error_message,
            c.follower_count::text AS follower_count,
            c.is_active,
            (c.raw_metadata ? 'vision') AS has_vision
     FROM scrape_jobs sj
     LEFT JOIN creators c ON c.handle = sj.target_handle
     WHERE sj.job_type = 'on_demand'
       AND sj.priority = 0
       AND sj.queued_at > NOW() - INTERVAL '24 hours'
     ORDER BY sj.queued_at DESC LIMIT 100`,
  );
  return NextResponse.json({ jobs: rows });
}
