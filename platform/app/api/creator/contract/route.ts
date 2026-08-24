import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildDealContract, type DealContractInput, type DealSignOff } from '@/lib/deal-contract';
import { creatorMayAccess } from '@/lib/creator-identity';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface SignRow { party: 'brand' | 'creator'; signer_name: string; signed_at: string }

async function loadSignOffs(recruitId: string): Promise<DealSignOff[]> {
  const db = getBolticClient();
  const rows = await db.query<SignRow>(
    `SELECT party, signer_name, signed_at::text AS signed_at
       FROM deal_signatures WHERE recruit_id = $1`,
    [recruitId],
  );
  return rows.map((r) => ({ party: r.party, signer_name: r.signer_name, signed_at: r.signed_at }));
}

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
      signOffs: await loadSignOffs(r.id),
    };

    return NextResponse.json(buildDealContract(input, new Date().toISOString()));
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * POST /api/creator/contract  { deal: <recruitId>, signer_name: string }
 *
 * Records the CREATOR's explicit e-signature on the agreement. Guarded to the
 * owning creator. Idempotent upsert (one signature per party per deal) — signing
 * again refreshes the name/timestamp. Returns the freshly rebuilt contract.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { deal?: string; signer_name?: string };
  try {
    body = (await request.json()) as { deal?: string; signer_name?: string };
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }

  const dealId = (body.deal ?? '').trim();
  const signerName = (body.signer_name ?? '').trim();
  if (!dealId) return NextResponse.json({ ok: false, reason: 'no_deal' }, { status: 400 });
  if (signerName.length < 2 || signerName.length > 120) {
    return NextResponse.json({ ok: false, reason: 'bad_name' }, { status: 400 });
  }

  const db = getBolticClient();
  try {
    const owners = await db.query<{ creator_id: string }>(
      `SELECT creator_id FROM program_recruits WHERE id = $1 LIMIT 1`,
      [dealId],
    );
    const owner = owners[0];
    if (!owner) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
    if (!(await creatorMayAccess(owner.creator_id))) {
      return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
    }

    await db.query(
      `INSERT INTO deal_signatures (recruit_id, party, signer_name)
       VALUES ($1, 'creator', $2)
       ON CONFLICT (recruit_id, party)
       DO UPDATE SET signer_name = EXCLUDED.signer_name, signed_at = now()`,
      [dealId, signerName],
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'db_error', error: (err as Error).message }, { status: 500 });
  }
}
