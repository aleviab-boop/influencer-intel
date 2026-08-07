import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildNotifications, type NotificationInput } from '@/lib/creator-notifications';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Row {
  id: string;
  rate: string | number | null;
  paid: boolean;
  paid_at: string | null;
  status: string;
  due_date: string | null;
  created_at: string | null;
  submissions: unknown;
  program_name: string | null;
  brand_name: string | null;
}

/**
 * GET /api/creator/notifications?handle=<h>|?account=<id>
 *
 * A "needs your attention" feed derived from the creator's program_recruits
 * rows — brand invites awaiting a reply, deadlines due/overdue, payments
 * received, payments pending too long. DB-only (no IG token) so it renders even
 * when the Instagram connection is stale. Always 200 — `{ available:false }`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;

  const db = getBolticClient();

  try {
    let creatorId: string | null = null;
    if (accountId) {
      const rows = await db.query<{ creator_id: string }>(
        `SELECT creator_id FROM connected_accounts WHERE id = $1 LIMIT 1`, [accountId],
      );
      creatorId = rows[0]?.creator_id ?? null;
    } else if (handle) {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM creators WHERE LOWER(handle) = $1 ORDER BY updated_at DESC LIMIT 1`, [handle],
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

    const rows = await db.query<Row>(
      `SELECT pr.id, pr.rate, pr.paid, pr.paid_at, pr.status,
              pr.due_date::text AS due_date, pr.created_at::text AS created_at,
              pr.submissions,
              p.name AS program_name, b.name AS brand_name
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE pr.creator_id = $1 AND pr.status <> 'declined'`,
      [creatorId],
    );

    const items: NotificationInput[] = rows.map((r) => ({
      id: r.id,
      brand: r.brand_name ?? 'A brand',
      program: r.program_name ?? 'Campaign',
      rate: num(r.rate),
      paid: !!r.paid,
      paid_at: r.paid_at,
      status: r.status,
      due_date: r.due_date ? r.due_date.slice(0, 10) : null,
      created_at: r.created_at,
      submissions: r.submissions,
    }));

    return NextResponse.json(buildNotifications(items, new Date().toISOString()));
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }
}
