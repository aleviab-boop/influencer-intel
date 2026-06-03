import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { Creator } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

const STALE_MS = 14 * 24 * 60 * 60 * 1000;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  const db = getBolticClient();
  const rows = await db.query<Creator>(
    `SELECT * FROM creators WHERE handle = $1 LIMIT 1`,
    [handle.toLowerCase()],
  );
  const creator = rows[0];
  if (!creator) return NextResponse.json({ error: 'creator not found' }, { status: 404 });

  const isStale = !creator.last_scraped_at ||
    Date.now() - new Date(creator.last_scraped_at).getTime() > STALE_MS;

  if (isStale) {
    enqueueRefresh(db, handle.toLowerCase()).catch(() => {});
  }

  return NextResponse.json({
    ...creator,
    _freshness: isStale ? 'refreshing' : 'fresh',
  });
}

async function enqueueRefresh(db: ReturnType<typeof getBolticClient>, handle: string) {
  const dup = await db.query<{ id: string }>(
    `SELECT id FROM scrape_jobs
     WHERE target_handle = $1 AND status IN ('queued','in_progress')
     LIMIT 1`,
    [handle],
  );
  if (dup.length > 0) return;
  await db.insert('scrape_jobs', {
    job_type: 'on_demand',
    target_platform: 'instagram',
    target_handle: handle,
    priority: 1,
    status: 'queued',
    attempts: 0,
    queued_at: new Date().toISOString(),
  });
}
