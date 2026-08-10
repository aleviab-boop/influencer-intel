import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getBolticClient } from '@influencer-intel/shared/db';
import {
  buildSubmissionView,
  validateSubmission,
  normalizeStored,
  type SubmissionInput,
  type SubmissionRecord,
} from '@/lib/deliverable-submission';
import { creatorMayAccess } from '@/lib/creator-identity';

export const runtime = 'nodejs';

interface DealRow {
  id: string;
  creator_id: string;
  status: string;
  paid: boolean;
  due_date: string | null;
  deliverables: string | null;
  submissions: unknown;
  program_name: string | null;
  brand_name: string | null;
}

async function loadDeal(db: ReturnType<typeof getBolticClient>, id: string): Promise<DealRow | null> {
  const rows = await db.query<DealRow>(
    `SELECT pr.id, pr.creator_id, pr.status, pr.paid, pr.due_date::text AS due_date,
            pr.deliverables, pr.submissions,
            p.name AS program_name, b.name AS brand_name
     FROM program_recruits pr
     JOIN programs p ON p.id = pr.program_id
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE pr.id = $1
     LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

function viewFor(row: DealRow, submissions: SubmissionRecord[]): ReturnType<typeof buildSubmissionView> {
  const input: SubmissionInput = {
    id: row.id,
    program: row.program_name ?? 'Campaign',
    brand: row.brand_name ?? 'Brand',
    status: row.status,
    paid: !!row.paid,
    due_date: row.due_date ? row.due_date.slice(0, 10) : null,
    deliverables: row.deliverables,
    submissions,
  };
  return buildSubmissionView(input, new Date().toISOString());
}

/** GET /api/creator/deals/:id/submissions — deliverable progress + attached links. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = getBolticClient();
  try {
    const row = await loadDeal(db, id);
    if (!row) return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    // A logged-in creator may only touch their own deliverables (preview unaffected).
    if (!(await creatorMayAccess(row.creator_id))) {
      return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    }
    return NextResponse.json(viewFor(row, normalizeStored(row.submissions)));
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/** POST /api/creator/deals/:id/submissions  Body: { url, label?, note? } — attach a live post link. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = getBolticClient();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const valid = validateSubmission(body);
    if (!valid.ok || !valid.record) {
      return NextResponse.json({ available: false, reason: 'invalid', error: valid.error }, { status: 200 });
    }

    const row = await loadDeal(db, id);
    if (!row) return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    // A logged-in creator may only touch their own deliverables (preview unaffected).
    if (!(await creatorMayAccess(row.creator_id))) {
      return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    }

    const existing = normalizeStored(row.submissions);
    const record: SubmissionRecord = { id: randomUUID(), created_at: new Date().toISOString(), ...valid.record };
    const next = [...existing, record];

    await db.update('program_recruits', { id: row.id }, { submissions: JSON.stringify(next) });
    return NextResponse.json({ saved: true, ...viewFor(row, next) });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/** DELETE /api/creator/deals/:id/submissions?sid=<submissionId> — remove an attached link. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sid = new URL(request.url).searchParams.get('sid');
  const db = getBolticClient();
  try {
    if (!sid) return NextResponse.json({ available: false, reason: 'missing_sid' }, { status: 200 });

    const row = await loadDeal(db, id);
    if (!row) return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    // A logged-in creator may only touch their own deliverables (preview unaffected).
    if (!(await creatorMayAccess(row.creator_id))) {
      return NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 });
    }

    const next = normalizeStored(row.submissions).filter((s) => s.id !== sid);
    await db.update('program_recruits', { id: row.id }, { submissions: JSON.stringify(next) });
    return NextResponse.json({ saved: true, ...viewFor(row, next) });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
