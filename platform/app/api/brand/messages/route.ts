import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getSession } from '@/lib/auth';
import { brandMayAccessProgram } from '@/lib/programs-service';
import {
  buildMessageThread, normalizeMessageBody, type MessageRow,
} from '@/lib/deal-messages';

export const runtime = 'nodejs';

interface DealRow {
  recruit_id: string;
  program_brand_id: string | null;
  handle: string | null;
  display_name: string | null;
}

// Resolves the deal by (program, creator) and confirms the signed-in brand owns
// the program. Returns the row or a short-circuit NextResponse.
async function loadOwnedDeal(programId: string, creatorId: string): Promise<{ row: DealRow } | { fail: NextResponse }> {
  const db = getBolticClient();
  const rows = await db.query<DealRow>(
    `SELECT pr.id AS recruit_id, p.brand_id AS program_brand_id,
            c.handle, c.display_name
     FROM program_recruits pr
     JOIN programs p ON p.id = pr.program_id
     JOIN creators c ON c.id = pr.creator_id
     WHERE pr.program_id = $1 AND pr.creator_id = $2 LIMIT 1`,
    [programId, creatorId],
  );
  const row = rows[0];
  if (!row) return { fail: NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 }) };
  const session = await getSession();
  if (!brandMayAccessProgram(row.program_brand_id, session?.brand_id)) {
    return { fail: NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 }) };
  }
  return { row };
}

/**
 * GET /api/brand/messages?program=<id>&creator=<id>
 *
 * The brand's view of the per-deal thread. Opening it marks the creator's
 * messages as read. Ownership-guarded to the signed-in brand. Always 200.
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
    const res = await loadOwnedDeal(programId, creatorId);
    if ('fail' in res) return res.fail;
    const recruitId = res.row.recruit_id;

    await db.query(
      `UPDATE deal_messages SET read_at = now()
       WHERE recruit_id = $1 AND sender = 'creator' AND read_at IS NULL`,
      [recruitId],
    );

    const rows = await db.query<MessageRow>(
      `SELECT id, sender, body, read_at::text AS read_at, created_at::text AS created_at
       FROM deal_messages WHERE recruit_id = $1 ORDER BY created_at ASC`,
      [recruitId],
    );

    const counterpart = res.row.display_name || (res.row.handle ? `@${res.row.handle}` : 'The creator');
    return NextResponse.json(buildMessageThread(rows, 'brand', counterpart, new Date().toISOString()));
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * POST /api/brand/messages?program=<id>&creator=<id>  { body: string }
 *
 * The brand sends a message to the creator on this deal. Ownership-guarded.
 * Always 200 with { saved }.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const programId = url.searchParams.get('program');
  const creatorId = url.searchParams.get('creator');
  if (!programId || !creatorId) {
    return NextResponse.json({ available: false, reason: 'missing_params' }, { status: 200 });
  }

  const db = getBolticClient();
  try {
    const res = await loadOwnedDeal(programId, creatorId);
    if ('fail' in res) return res.fail;

    const payload = (await request.json().catch(() => ({}))) as { body?: unknown };
    const body = normalizeMessageBody(payload.body);
    if (!body) return NextResponse.json({ available: true, saved: false, error: 'empty_message' }, { status: 200 });

    const inserted = await db.query<MessageRow>(
      `INSERT INTO deal_messages (recruit_id, sender, body)
       VALUES ($1, 'brand', $2)
       RETURNING id, sender, body, read_at::text AS read_at, created_at::text AS created_at`,
      [res.row.recruit_id, body],
    );

    return NextResponse.json({ available: true, saved: true, message: inserted[0] });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
