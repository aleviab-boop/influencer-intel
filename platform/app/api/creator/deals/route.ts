import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildDealWorkspace, type DealInput } from '@/lib/deal-workspace';

export const runtime = 'nodejs';

// Postgres returns NUMERIC/BIGINT as strings — coerce before math.
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface DealRow {
  id: string;
  rate: string | number | null;
  paid: boolean;
  paid_at: string | null;
  status: string;
  deliverables: string | null;
  due_date: string | null;
  program_name: string | null;
  brand_name: string | null;
}

/**
 * GET /api/creator/deals?account=<id>|?handle=<h>
 *
 * Creator-facing deal WORKSPACE: the same program_recruits rows the earnings
 * summary and brand kanban read, reshaped into a runnable lifecycle (in progress
 * → awaiting payment → paid) with deliverable checklists, deadline countdowns and
 * next actions. DB-only (no IG token) so it renders even when the Instagram
 * connection is stale. Always 200 — `{ available:false }` carries a reason.
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

    const rows = await db.query<DealRow>(
      `SELECT pr.id, pr.rate, pr.paid, pr.paid_at, pr.status, pr.deliverables,
              pr.due_date::text AS due_date,
              p.name AS program_name, b.name AS brand_name
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE pr.creator_id = $1 AND pr.status <> 'declined'
       ORDER BY COALESCE(pr.due_date, pr.created_at::date) DESC`,
      [creatorId],
    );

    const deals: DealInput[] = rows.map((d) => ({
      id: d.id,
      brand: d.brand_name ?? 'Brand',
      program: d.program_name ?? 'Campaign',
      rate: num(d.rate),
      paid: !!d.paid,
      paid_at: d.paid_at,
      status: d.status,
      deliverables: d.deliverables,
      due_date: d.due_date ? d.due_date.slice(0, 10) : null,
    }));

    const workspace = buildDealWorkspace(deals, new Date().toISOString());
    return NextResponse.json(workspace);
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }
}
