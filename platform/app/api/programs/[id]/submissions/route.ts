import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import {
  normalizeStored,
  setSubmissionReview,
  type SubmissionReview,
} from '@/lib/deliverable-submission';
import { buildProgramReview, type ReviewRecruitInput } from '@/lib/submission-review';

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

interface RecruitRow {
  creator_id: string;
  handle: string | null;
  display_name: string | null;
  status: string;
  rate: string | number | null;
  paid: boolean;
  due_date: string | null;
  deliverables: string | null;
  submissions: unknown;
}

async function loadProgramName(
  db: ReturnType<typeof getBolticClient>,
  id: string,
): Promise<string | null> {
  const rows = await db.query<{ name: string | null }>(
    `SELECT name FROM programs WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  return rows[0]?.name ?? 'Campaign';
}

async function loadRecruits(
  db: ReturnType<typeof getBolticClient>,
  id: string,
): Promise<ReviewRecruitInput[]> {
  const rows = await db.query<RecruitRow>(
    `SELECT pr.creator_id, c.handle, c.display_name, pr.status, pr.rate,
            pr.paid, pr.due_date::text AS due_date, pr.deliverables, pr.submissions
     FROM program_recruits pr
     JOIN creators c ON c.id = pr.creator_id
     WHERE pr.program_id = $1 AND pr.status <> 'declined'
     ORDER BY pr.created_at DESC`,
    [id],
  );
  return rows.map((r) => ({
    creator_id: r.creator_id,
    handle: r.handle ?? 'creator',
    display_name: r.display_name,
    status: r.status,
    rate: num(r.rate),
    paid: !!r.paid,
    due_date: r.due_date ? r.due_date.slice(0, 10) : null,
    deliverables: r.deliverables,
    submissions: r.submissions,
  }));
}

/**
 * GET /api/programs/[id]/submissions — the brand's review queue for one campaign:
 * every recruited creator's submitted post links, classified into
 * pending/approved/changes and flagged when a creator is fully approved and
 * ready to pay. Read-only; brand HTTP conventions (404 if the program is gone).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const db = getBolticClient();
  try {
    const name = await loadProgramName(db, id);
    if (name === null) return NextResponse.json({ error: 'program not found' }, { status: 404 });
    const recruits = await loadRecruits(db, id);
    return NextResponse.json(buildProgramReview(id, name, recruits, istToday()));
  } catch (err) {
    console.error('[programs] submission review load failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * PATCH /api/programs/[id]/submissions
 *   { creator_id, submission_id, state: 'approved' | 'changes' | null, comment? }
 * → record (or clear, with null) the brand's verdict on one submitted link,
 *   then return the refreshed review for the whole campaign.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.creator_id !== 'string' || typeof body.submission_id !== 'string') {
    return NextResponse.json({ error: 'creator_id and submission_id are required' }, { status: 400 });
  }
  const { state } = body;
  if (state !== 'approved' && state !== 'changes' && state !== null) {
    return NextResponse.json({ error: "state must be 'approved', 'changes', or null" }, { status: 400 });
  }

  const db = getBolticClient();
  try {
    const rows = await db.query<{ submissions: unknown }>(
      `SELECT submissions FROM program_recruits WHERE program_id = $1 AND creator_id = $2 LIMIT 1`,
      [id, body.creator_id],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'recruit not found' }, { status: 404 });

    const records = normalizeStored(rows[0]?.submissions);
    const review: SubmissionReview | null =
      state === null
        ? null
        : {
            state,
            at: new Date().toISOString(),
            comment: typeof body.comment === 'string' ? body.comment.trim().slice(0, 280) || null : null,
          };

    const { records: next, matched } = setSubmissionReview(records, body.submission_id, review);
    if (!matched) return NextResponse.json({ error: 'submission not found' }, { status: 404 });

    await db.update(
      'program_recruits',
      { program_id: id, creator_id: body.creator_id },
      { submissions: JSON.stringify(next) },
    );

    const name = (await loadProgramName(db, id)) ?? 'Campaign';
    const recruits = await loadRecruits(db, id);
    return NextResponse.json(buildProgramReview(id, name, recruits, istToday()));
  } catch (err) {
    console.error('[programs] submission review update failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
