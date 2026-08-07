import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildContentCalendar, type CalendarDealInput } from '@/lib/content-calendar';

export const runtime = 'nodejs';

const IST_OFFSET_MIN = 5 * 60 + 30;

// Postgres returns NUMERIC/BIGINT as strings — coerce before math.
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Today + current month, in IST (creators here bill in INR/IST).
function istNow(): { today: string; month: string } {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth();
  const d = nowIst.getUTCDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return { today: `${y}-${pad(m + 1)}-${pad(d)}`, month: `${y}-${pad(m + 1)}` };
}

interface CalRow {
  id: string;
  rate: string | number | null;
  paid: boolean;
  status: string;
  due_date: string | null;
  program_name: string | null;
  brand_name: string | null;
}

/**
 * GET /api/creator/calendar?account=<id>|?handle=<h>&month=YYYY-MM
 *
 * Lays the creator's deal deadlines onto a month grid so planning content is
 * spatial rather than a scroll through cards. Same program_recruits rows the
 * deals workspace reads; DB-only, always 200. `month` drives navigation and
 * defaults to the current IST month.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '') ?? null;
  const monthParam = url.searchParams.get('month');

  const db = getBolticClient();
  const { today, month: currentMonth } = istNow();
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth;

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
      return NextResponse.json({ available: false, reason: 'no_creator', month }, { status: 200 });
    }

    const rows = await db.query<CalRow>(
      `SELECT pr.id, pr.rate, pr.paid, pr.status,
              pr.due_date::text AS due_date,
              p.name AS program_name, b.name AS brand_name
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE pr.creator_id = $1 AND pr.status <> 'declined'`,
      [creatorId],
    );

    const deals: CalendarDealInput[] = rows.map((d) => ({
      id: d.id,
      program: d.program_name ?? 'Campaign',
      brand: d.brand_name ?? 'Brand',
      rate: num(d.rate),
      paid: !!d.paid,
      status: d.status,
      due_date: d.due_date ? d.due_date.slice(0, 10) : null,
    }));

    return NextResponse.json(buildContentCalendar(deals, month, today));
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message, month },
      { status: 200 },
    );
  }
}
