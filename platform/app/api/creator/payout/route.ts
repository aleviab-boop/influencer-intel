import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { validatePayout, toDisplay, type PayoutInput, type PayoutRecord } from '@/lib/creator-payout';

export const runtime = 'nodejs';

async function resolveCreatorId(
  db: ReturnType<typeof getBolticClient>,
  accountId: string | null,
  handle: string | null,
): Promise<string | null> {
  if (accountId) {
    const rows = await db.query<{ creator_id: string }>(
      `SELECT creator_id FROM connected_accounts WHERE id = $1 LIMIT 1`, [accountId],
    );
    return rows[0]?.creator_id ?? null;
  }
  if (handle) {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM creators WHERE LOWER(handle) = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`, [handle],
    );
    return rows[0]?.id ?? null;
  }
  const rows = await db.query<{ creator_id: string }>(
    `SELECT creator_id FROM connected_accounts WHERE connection_status = 'active'
     ORDER BY connected_at DESC LIMIT 1`,
  );
  return rows[0]?.creator_id ?? null;
}

// creators.payout_details may come back as an object or a JSON string.
function parseRecord(v: unknown): PayoutRecord | null {
  if (!v) return null;
  const obj = typeof v === 'string' ? safeParse(v) : v;
  if (obj && typeof obj === 'object' && 'method' in obj) return obj as PayoutRecord;
  return null;
}
function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** GET /api/creator/payout?handle=|account= — masked payout details. */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;
  const db = getBolticClient();

  try {
    const creatorId = await resolveCreatorId(db, accountId, handle);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const rows = await db.query<{ payout_details: unknown }>(
      `SELECT payout_details FROM creators WHERE id = $1 LIMIT 1`, [creatorId],
    );
    return NextResponse.json({ available: true, payout: toDisplay(parseRecord(rows[0]?.payout_details)) });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * PATCH /api/creator/payout?handle=|account=
 * Body: { method:'upi'|'bank', upi_id? , account_holder?, account_number?, ifsc? }
 * Validates to Indian UPI/IFSC formats, then stores the record in
 * creators.payout_details. Returns the masked display view (never the full
 * account number).
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;
  const db = getBolticClient();

  try {
    const body = (await request.json().catch(() => ({}))) as PayoutInput;
    const { ok, record, errors } = validatePayout(body, new Date().toISOString());
    if (!ok || !record) return NextResponse.json({ available: true, saved: false, errors }, { status: 200 });

    const creatorId = await resolveCreatorId(db, accountId, handle);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    await db.update('creators', { id: creatorId }, {
      payout_details: JSON.stringify(record),
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ available: true, saved: true, payout: toDisplay(record) });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
