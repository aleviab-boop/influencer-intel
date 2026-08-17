import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getSession } from '@/lib/auth';
import { brandMayAccessProgram } from '@/lib/programs-service';
import { buildDealContract, type DealContractInput } from '@/lib/deal-contract';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Row {
  id: string;
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
  program_brand_id: string | null;
  brand_name: string | null;
  handle: string | null;
  display_name: string | null;
}

/**
 * GET /api/brand/contract?program=<programId>&creator=<creatorId>
 *
 * The brand's view of the same collaboration agreement the creator sees —
 * identical pure builder (buildDealContract), resolved by (program, creator)
 * since that's what the campaign + review surfaces carry. Ownership-guarded to
 * the signed-in brand (unassigned/demo programs stay open, mirroring
 * brandMayAccessProgram). DB-only. Always 200 — `{ available:false }` when the
 * deal doesn't resolve or isn't theirs.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const programId = url.searchParams.get('program');
  const creatorId = url.searchParams.get('creator');
  if (!programId || !creatorId) {
    return NextResponse.json({ available: false, reason: 'missing_params' }, { status: 200 });
  }

  const db = getBolticClient();
  try {
    const rows = await db.query<Row>(
      `SELECT pr.id, pr.rate, pr.deliverables, pr.note,
              pr.due_date::text AS due_date, pr.paid, pr.paid_at::text AS paid_at,
              pr.status, pr.created_at::text AS created_at, pr.updated_at::text AS updated_at,
              p.name AS program_name, p.description AS program_description, p.brand_id AS program_brand_id,
              b.name AS brand_name,
              c.handle, c.display_name
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       JOIN creators c ON c.id = pr.creator_id
       WHERE pr.program_id = $1 AND pr.creator_id = $2
       LIMIT 1`,
      [programId, creatorId],
    );

    const r = rows[0];
    if (!r) return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });

    // A signed-in brand may only open agreements on their own programs.
    const session = await getSession();
    if (!brandMayAccessProgram(r.program_brand_id, session?.brand_id)) {
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
