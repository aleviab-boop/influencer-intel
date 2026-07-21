import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// DELETE /api/admin/jobs?id=<jobId>
//   Cancel a QUEUED crawl so it doesn't sit in the queue burning account budget.
//   Guarded to status='queued' only — never touches an in-progress crawl or the
//   completed/failed history.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const rows = await getBolticClient().query<{ id: string }>(
      `DELETE FROM scrape_jobs WHERE id = $1 AND status = 'queued' RETURNING id`,
      [id],
    );
    return NextResponse.json({ deleted: rows.length }); // 0 if it wasn't queued (already running/done)
  } catch {
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}

// GET /api/admin/jobs
//   Recent crawl jobs so the admin can see what the worker has actually been
//   doing — targets, status, timing, result counts, and any errors — without
//   tailing the terminal.
export async function GET() {
  const db = getBolticClient();

  let jobs: Array<Record<string, unknown>> = [];
  try {
    jobs = await db.query(
      `SELECT id, job_type, target_handle, status, attempts, error_message, result_summary,
              queued_at, started_at, completed_at
       FROM scrape_jobs
       ORDER BY coalesce(completed_at, started_at, queued_at) DESC NULLS LAST
       LIMIT 30`,
    );
  } catch {
    jobs = [];
  }

  // Rolling 24h counts for a quick health header.
  let counts = { completed_24h: 0, failed_24h: 0, skipped_24h: 0, queued: 0, in_progress: 0 };
  try {
    const r = await db.query<typeof counts>(
      `SELECT
         count(*) FILTER (WHERE status='completed' AND completed_at > now()-interval '24 hours')::int AS completed_24h,
         count(*) FILTER (WHERE status='failed' AND completed_at > now()-interval '24 hours')::int AS failed_24h,
         count(*) FILTER (WHERE status='skipped' AND coalesce(completed_at,updated_at) > now()-interval '24 hours')::int AS skipped_24h,
         count(*) FILTER (WHERE status='queued')::int AS queued,
         count(*) FILTER (WHERE status='in_progress')::int AS in_progress
       FROM scrape_jobs`,
    );
    if (r[0]) counts = r[0];
  } catch {
    /* keep defaults */
  }

  return NextResponse.json({
    counts,
    jobs: jobs.map((j) => {
      // result_summary may carry a found/saved count from discovery.
      const rs = (j.result_summary ?? null) as Record<string, unknown> | null;
      const found =
        rs && typeof rs === 'object'
          ? Number(rs.saved ?? rs.added ?? rs.candidates ?? rs.count ?? 0) || null
          : null;
      return {
        id: j.id,
        job_type: j.job_type,
        target: j.target_handle,
        status: j.status,
        attempts: Number(j.attempts ?? 0),
        error: (j.error_message as string) ?? null,
        found,
        queued_at: j.queued_at,
        started_at: j.started_at,
        completed_at: j.completed_at,
      };
    }),
  });
}
