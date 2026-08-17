import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { creatorMayAccess } from '@/lib/creator-identity';
import {
  buildMessageThread, normalizeMessageBody, type MessageRow,
} from '@/lib/deal-messages';

export const runtime = 'nodejs';

interface DealRow {
  creator_id: string;
  brand_name: string | null;
}

// Loads the deal (recruit) and confirms the caller owns it. Returns the row, or
// a NextResponse to short-circuit with when it doesn't resolve / isn't theirs.
async function loadOwnedDeal(id: string): Promise<{ row: DealRow } | { fail: NextResponse }> {
  const db = getBolticClient();
  const rows = await db.query<DealRow>(
    `SELECT pr.creator_id, b.name AS brand_name
     FROM program_recruits pr
     JOIN programs p ON p.id = pr.program_id
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE pr.id = $1 LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return { fail: NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 }) };
  if (!(await creatorMayAccess(row.creator_id))) {
    return { fail: NextResponse.json({ available: false, reason: 'not_found' }, { status: 200 }) };
  }
  return { row };
}

/**
 * GET /api/creator/deals/:id/messages
 *
 * The creator's view of the per-deal thread. Opening it marks the brand's
 * messages as read (unread → seen). Guarded to the owning creator. Always 200.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = getBolticClient();
  try {
    const res = await loadOwnedDeal(id);
    if ('fail' in res) return res.fail;

    // Opening the thread clears the counterpart's unread messages for me.
    await db.query(
      `UPDATE deal_messages SET read_at = now()
       WHERE recruit_id = $1 AND sender = 'brand' AND read_at IS NULL`,
      [id],
    );

    const rows = await db.query<MessageRow>(
      `SELECT id, sender, body, read_at::text AS read_at, created_at::text AS created_at
       FROM deal_messages WHERE recruit_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    return NextResponse.json(
      buildMessageThread(rows, 'creator', res.row.brand_name ?? 'The brand', new Date().toISOString()),
    );
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * POST /api/creator/deals/:id/messages  { body: string }
 *
 * The creator sends a message to the brand on this deal. Guarded to the owner.
 * Always 200 with { saved }.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const db = getBolticClient();
  try {
    const res = await loadOwnedDeal(id);
    if ('fail' in res) return res.fail;

    const payload = (await request.json().catch(() => ({}))) as { body?: unknown };
    const body = normalizeMessageBody(payload.body);
    if (!body) return NextResponse.json({ available: true, saved: false, error: 'empty_message' }, { status: 200 });

    const inserted = await db.query<MessageRow>(
      `INSERT INTO deal_messages (recruit_id, sender, body)
       VALUES ($1, 'creator', $2)
       RETURNING id, sender, body, read_at::text AS read_at, created_at::text AS created_at`,
      [id, body],
    );

    return NextResponse.json({ available: true, saved: true, message: inserted[0] });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
