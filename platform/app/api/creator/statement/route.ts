import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildEarningsStatement, type StatementDealInput } from '@/lib/earnings-statement';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';

const IST_OFFSET_MIN = 5 * 60 + 30;

// Postgres returns NUMERIC/BIGINT as strings — coerce before math.
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function istToday(): string {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${nowIst.getUTCFullYear()}-${pad(nowIst.getUTCMonth() + 1)}-${pad(nowIst.getUTCDate())}`;
}

interface StmtRow {
  id: string;
  rate: string | number | null;
  paid: boolean;
  paid_at: string | null;
  status: string;
  program_name: string | null;
  brand_name: string | null;
}

/**
 * GET /api/creator/statement?account=<id>|?handle=<h>&fy=YYYY-YY
 *
 * India-FY earnings statement: rolls the creator's PAID program_recruits rows
 * into a monthly + per-brand breakdown with an estimated TDS figure, for tax
 * time. Same rows the goal tracker reads; DB-only, always 200. `fy` drives
 * navigation and defaults to the current financial year.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const fyParam = url.searchParams.get('fy') ?? '';

  const db = getBolticClient();
  const today = istToday();

  try {
    // Session-first identity: a logged-in creator only ever sees their own statement.
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) {
      return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });
    }

    const rows = await db.query<StmtRow>(
      `SELECT pr.id, pr.rate, pr.paid, pr.paid_at::text AS paid_at, pr.status,
              p.name AS program_name, b.name AS brand_name
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE pr.creator_id = $1 AND pr.status <> 'declined'`,
      [creatorId],
    );

    const deals: StatementDealInput[] = rows.map((d) => ({
      id: d.id,
      program: d.program_name ?? 'Campaign',
      brand: d.brand_name ?? 'Brand',
      rate: num(d.rate),
      paid: !!d.paid,
      paid_at: d.paid_at,
      status: d.status,
    }));

    return NextResponse.json(buildEarningsStatement(deals, fyParam, today));
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }
}
