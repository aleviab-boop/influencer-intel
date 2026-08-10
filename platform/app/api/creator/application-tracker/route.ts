import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildApplicationTracker, type ApplicationInput } from '@/lib/application-tracker';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';

const IST_OFFSET_MIN = 5 * 60 + 30;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function istToday(): string {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${nowIst.getUTCFullYear()}-${pad(nowIst.getUTCMonth() + 1)}-${pad(nowIst.getUTCDate())}`;
}

interface AppRow {
  program_id: string;
  status: string;
  rate: string | number | null;
  created_at: string | null;
  program_name: string | null;
  brand_name: string | null;
}

/**
 * GET /api/creator/application-tracker?account=<id>|?handle=<h>
 *
 * The creator's application pipeline: every program_recruits row they hold,
 * classified by where it stands (awaiting review → brand responded → accepted →
 * closed) so applications don't vanish between "applied" and "live deal". Same
 * rows the deals workspace reads; DB-only, always 200.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const db = getBolticClient();

  try {
    // Session-first identity: a logged-in creator only ever sees their own pipeline.
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) {
      return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });
    }

    const rows = await db.query<AppRow>(
      `SELECT pr.program_id, pr.status, pr.rate, pr.created_at::text AS created_at,
              p.name AS program_name, b.name AS brand_name
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE pr.creator_id = $1
       ORDER BY pr.created_at DESC`,
      [creatorId],
    );

    const apps: ApplicationInput[] = rows.map((r) => ({
      program_id: r.program_id,
      program: r.program_name ?? 'Campaign',
      brand: r.brand_name ?? 'Brand',
      status: r.status,
      rate: num(r.rate),
      created_at: r.created_at,
    }));

    return NextResponse.json(buildApplicationTracker(apps, istToday()));
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }
}
