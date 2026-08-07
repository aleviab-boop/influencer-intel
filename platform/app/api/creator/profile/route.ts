import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { sanitizeSettingsEdit, type SettingsEditInput } from '@/lib/creator-settings';

export const runtime = 'nodejs';

interface ProfileRow {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  primary_city: string | null;
  profile_photo_url: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  is_verified: boolean | null;
}

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

const SELECT = `SELECT id, handle, display_name, bio, primary_category, primary_city,
                       profile_photo_url, follower_count, engagement_rate, is_verified
                FROM creators WHERE id = $1 LIMIT 1`;

/** GET /api/creator/profile?handle=|account= — editable profile fields. */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;
  const db = getBolticClient();

  try {
    const creatorId = await resolveCreatorId(db, accountId, handle);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const rows = await db.query<ProfileRow>(SELECT, [creatorId]);
    const p = rows[0];
    if (!p) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    return NextResponse.json({ available: true, profile: p });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * PATCH /api/creator/profile?handle=|account=
 * Body: { display_name?, bio?, primary_category?, primary_city? }
 * Whitelisted edit of the creator's display fields (the sanitize lib enforces
 * the allow-list and length limits). Returns the updated profile.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;
  const db = getBolticClient();

  try {
    const body = (await request.json().catch(() => ({}))) as SettingsEditInput;
    const { ok, set, errors } = sanitizeSettingsEdit(body);
    if (!ok) return NextResponse.json({ available: true, saved: false, errors }, { status: 200 });

    const creatorId = await resolveCreatorId(db, accountId, handle);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    if (Object.keys(set).length > 0) {
      await db.update('creators', { id: creatorId }, { ...set, updated_at: new Date().toISOString() });
    }

    const rows = await db.query<ProfileRow>(SELECT, [creatorId]);
    return NextResponse.json({ available: true, saved: true, profile: rows[0] ?? null });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
