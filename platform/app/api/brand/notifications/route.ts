import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getSession } from '@/lib/auth';
import { buildBrandNotifications, type BrandNotificationInput } from '@/lib/brand-notifications';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Row {
  recruit_id: string;
  program_id: string;
  program_name: string | null;
  handle: string | null;
  display_name: string | null;
  status: string;
  rate: string | number | null;
  paid: boolean;
  due_date: string | null;
  updated_at: string | null;
  created_at: string | null;
  submissions: unknown;
}

/**
 * GET /api/brand/notifications
 *
 * The agency's "here's what needs you today" feed — derived from the brand's
 * program_recruits rows (same data the campaign + payout views read): creators
 * who accepted/declined, submissions awaiting review, deals ready to pay,
 * invites with no reply, and overdue deliverables. Scoped to the signed-in
 * brand PLUS legacy/unassigned demo programs, mirroring listPrograms. DB-only.
 * Always 200 — `{ available:false }` when there's nothing to show.
 */
export async function GET(): Promise<NextResponse> {
  const db = getBolticClient();

  try {
    const session = await getSession();
    const brandId = session?.brand_id ?? null;
    const where = brandId ? `AND (p.brand_id = $1 OR p.brand_id IS NULL)` : '';

    const rows = await db.query<Row>(
      `SELECT pr.id AS recruit_id, pr.program_id,
              p.name AS program_name,
              c.handle, c.display_name,
              pr.status, pr.rate, pr.paid,
              pr.due_date::text AS due_date,
              pr.updated_at::text AS updated_at,
              pr.created_at::text AS created_at,
              pr.submissions
       FROM program_recruits pr
       JOIN programs p ON p.id = pr.program_id
       JOIN creators c ON c.id = pr.creator_id
       WHERE 1 = 1 ${where}`,
      brandId ? [brandId] : undefined,
    );

    const items: BrandNotificationInput[] = rows.map((r) => ({
      recruit_id: r.recruit_id,
      program_id: r.program_id,
      program: r.program_name ?? 'Campaign',
      creator: r.display_name || (r.handle ? `@${r.handle}` : 'A creator'),
      status: r.status,
      rate: num(r.rate),
      paid: !!r.paid,
      due_date: r.due_date ? r.due_date.slice(0, 10) : null,
      updated_at: r.updated_at,
      created_at: r.created_at,
      submissions: r.submissions,
    }));

    return NextResponse.json(buildBrandNotifications(items, new Date().toISOString()));
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }
}
