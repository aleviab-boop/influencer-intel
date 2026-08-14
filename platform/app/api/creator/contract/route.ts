import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildDealContract, type DealContractInput } from '@/lib/deal-contract';
import { creatorMayAccess } from '@/lib/creator-identity';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Row {
  id: string;
  creator_id: string;
  rate: string | number | null;
  deliverables: string | null;
  note: string | null;
  due_date: string | null;
  paid: boolean;
  paid_at: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  program_name: string | null;
  program_description: string | null;
  brand_name: string | null;
  handle: string | null;
  display_name: string | null;
}

/**
 * GET /api/creator/contract?deal=<recruitId>
 *
 * Builds the influencer collaboration agreement for a single deal from the deal
 * row plus program/brand/creator names — the paperwork behind an accepted
 * invite. DB-only, pure builder. Guarded to the owning creator (preview
 * unaffected). Always 200 — `{ available:false }` when the deal doesn't resolve.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const dealId = url.searchParams.get('deal');
  if (!dealId) return NextResponse.json({ available: false, reason: 'no_deal' }, { status: 200 });

  const db = getBolticClient();
  try {
    const rows = await db.query<Row>(
      `SELECT pr.id, pr.creator_id, pr.rate, pr.deliverables, pr.note,
              pr.due_date::text AS due_date, pr.paid, pr.paid_at::text AS paid_at,
              pr.status, pr.created_at::text AS created_at, pr.updated_at::text AS updated_at,
              p.name AS program_name, p.description AS program_description,
              b.name AS brand_name,
              c.handle, c.display_name
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       JOIN creators c ON c.id = pr.creator_id
       WHERE pr.id = $1
       LIMIT 1`,
      [dealId],
    );

    const r = rows[0];
    if (!r) return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });

    // A logged-in creator may only open their own contract (preview unaffected).
    if (!(await creatorMayAccess(r.creator_id))) {
      return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    }

    const input: DealContractInput = {
      id: r.id,
      brand: r.brand_name ?? 'Brand',
      creator: r.display_name || (r.handle ? `@${r.handle}` : 'Creator'),
      creator_handle: r.handle,
      program: r.program_name ?? 'Campaign',
      description: r.program_description,
      deliverables: r.deliverables,
      rate: num(r.rate),
      paid: !!r.paid,
      paid_at: r.paid_at,
      status: r.status,
      due_date: r.due_date ? r.due_date.slice(0, 10) : null,
      note: r.note,
      created_at: r.created_at,
      accepted_at: r.updated_at,
    };

    return NextResponse.json(buildDealContract(input, new Date().toISOString()));
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
