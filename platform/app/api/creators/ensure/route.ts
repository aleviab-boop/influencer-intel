import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// POST /api/creators/ensure
//   Body: { handle, full_name?, biography?, category?, followers?, engagement?,
//           is_verified?, profile_pic_url? }
//   Make sure a live-discovered creator has a row in `creators`, then return its
//   id so the caller can recruit it into a campaign. Live Instagram finds don't
//   exist in our DB yet (no creator_id), so the Lander's "Add to campaign" button
//   is otherwise dead for them — this bridges that gap.
//
//   If the handle already exists we return the existing id untouched. Otherwise we
//   insert a minimal row with a CHECK-valid source ('manual', i.e. a human pulled
//   it in). Best-effort field fill from whatever the live row already knows.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | {
        handle?: string;
        full_name?: string;
        biography?: string;
        category?: string;
        followers?: number;
        engagement?: number;
        is_verified?: boolean;
        profile_pic_url?: string | null;
      }
    | null;

  const handle = (body?.handle ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    return NextResponse.json({ error: 'valid handle required' }, { status: 400 });
  }

  try {
    const db = getBolticClient();

    const existing = await db.query<{ id: string }>(
      `SELECT id FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
    if (existing.length > 0) {
      return NextResponse.json({ creator_id: existing[0]!.id, created: false });
    }

    const row = await db.insert<{ id: string }>('creators', {
      handle,
      platform: 'instagram',
      is_active: true,
      source: 'manual',
      display_name: body?.full_name ?? '',
      bio: body?.biography ?? '',
      primary_category: body?.category ?? null,
      follower_count: typeof body?.followers === 'number' ? body.followers : 0,
      is_verified: Boolean(body?.is_verified),
      profile_photo_url: body?.profile_pic_url ?? null,
      // Live engagement comes in as a percentage (e.g. 4.7); store as a fraction.
      engagement_rate: typeof body?.engagement === 'number' ? body.engagement / 100 : null,
      last_scraped_at: new Date().toISOString(),
    });

    return NextResponse.json({ creator_id: row.id, created: true });
  } catch (err) {
    console.error('[creators/ensure] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
