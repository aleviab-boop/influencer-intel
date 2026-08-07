import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildApplicationTracker, type ApplicationInput } from '@/lib/application-tracker';

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
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '') ?? null;

  const db = getBolticClient();

  try {
    // Resolve the creator: account id > handle > most-recent connected account.
    let creatorId: string | null = null;
    if (accountId) {
      const rows = await db.query<{ creator_id: string }>(
        `SELECT creator_id FROM connected_accounts WHERE id = $1 LIMIT 1`, [accountId],
      );
      creatorId = rows[0]?.creator_id ?? null;
    } else if (handle) {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM creators WHERE handle = $1 ORDER BY updated_at DESC LIMIT 1`, [handle],
      );
      creatorId = rows[0]?.id ?? null;
    } else {
      const rows = await db.query<{ creator_id: string }>(
        `SELECT creator_id FROM connected_accounts WHERE connection_status = 'active'
         ORDER BY connected_at DESC LIMIT 1`,
      );
      creatorId = rows[0]?.creator_id ?? null;
    }

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
