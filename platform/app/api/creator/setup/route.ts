import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { computeCompleteness, type CompletenessInput } from '@/lib/profile-completeness';

export const runtime = 'nodejs';

interface CreatorRow {
  id: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  primary_city: string | null;
  profile_photo_url: string | null;
  follower_count: number | string | null;
  payout_details: unknown;
}

function payoutComplete(v: unknown): boolean {
  const obj = typeof v === 'string' ? safeParse(v) : v;
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  if (r.method === 'upi') return !!r.upi_id;
  if (r.method === 'bank') return !!(r.account_holder && r.account_number && r.ifsc);
  return false;
}
function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * GET /api/creator/setup?handle=|account=
 *
 * Profile-completeness checklist — reads the creator row, their payout status
 * and whether they have any campaign activity, and scores how brand-ready they
 * are with an ordered next-step list. DB-only. Always 200.
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
        `SELECT id FROM creators WHERE LOWER(handle) = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`, [handle],
      );
      creatorId = rows[0]?.id ?? null;
    } else {
      const rows = await db.query<{ creator_id: string }>(
        `SELECT creator_id FROM connected_accounts WHERE connection_status = 'active'
         ORDER BY connected_at DESC LIMIT 1`,
      );
      creatorId = rows[0]?.creator_id ?? null;
    }

    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const [c] = await db.query<CreatorRow>(
      `SELECT id, display_name, bio, primary_category, primary_city, profile_photo_url,
              follower_count, payout_details
       FROM creators WHERE id = $1 LIMIT 1`,
      [creatorId],
    );
    if (!c) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const activityRows = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM program_recruits WHERE creator_id = $1`, [creatorId],
    );
    const activityCount = activityRows[0]?.n ?? 0;

    const input: CompletenessInput = {
      has_name: !!(c.display_name && c.display_name.trim()),
      has_bio: !!(c.bio && c.bio.trim().length >= 20),
      has_category: !!(c.primary_category && c.primary_category.trim()),
      has_city: !!(c.primary_city && c.primary_city.trim()),
      has_photo: !!(c.profile_photo_url && c.profile_photo_url.trim()),
      has_followers: Number(c.follower_count) > 0,
      has_payout: payoutComplete(c.payout_details),
      has_activity: Number(activityCount) > 0,
    };

    return NextResponse.json({ available: true, ...computeCompleteness(input) });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
