import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildDealBrief, type DealBriefInput } from '@/lib/deal-brief';
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
  paid: boolean;
  paid_at: string | null;
  status: string;
  deliverables: string | null;
  note: string | null;
  due_date: string | null;
  created_at: string | null;
  program_name: string | null;
  program_description: string | null;
  brand_name: string | null;
}

/**
 * GET /api/creator/deals/:id
 *
 * Full brief for a single program_recruits row — the description, deliverables,
 * rate, timeline, and three copyable response drafts (accept / counter /
 * clarify) built by the pure deal-brief lib. DB-only. Always 200 —
 * `{ available:false }` when the id doesn't resolve.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = getBolticClient();

  try {
    const rows = await db.query<Row>(
      `SELECT pr.id, pr.creator_id, pr.rate, pr.paid, pr.paid_at, pr.status, pr.deliverables, pr.note,
              pr.due_date::text AS due_date, pr.created_at::text AS created_at,
              p.name AS program_name, p.description AS program_description,
              b.name AS brand_name
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE pr.id = $1
       LIMIT 1`,
      [id],
    );

    const r = rows[0];
    if (!r) {
      return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    }

    // A logged-in creator may only open their own deal brief (preview unaffected).
    if (!(await creatorMayAccess(r.creator_id))) {
      return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    }

    const input: DealBriefInput = {
      id: r.id,
      brand: r.brand_name ?? 'A brand',
      program: r.program_name ?? 'Campaign',
      description: r.program_description,
      rate: num(r.rate),
      paid: !!r.paid,
      paid_at: r.paid_at,
      status: r.status,
      deliverables: r.deliverables,
      due_date: r.due_date ? r.due_date.slice(0, 10) : null,
      note: r.note,
      created_at: r.created_at,
    };

    return NextResponse.json(buildDealBrief(input, new Date().toISOString()));
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }
}
