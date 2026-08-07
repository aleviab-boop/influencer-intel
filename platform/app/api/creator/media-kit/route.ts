import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildMediaKit, type MediaKitCreatorRow } from '@/lib/media-kit-builder';

export const runtime = 'nodejs';

/**
 * GET /api/creator/media-kit?handle=<h>|?account=<id>
 *
 * DB-only media-kit payload. The live media kit reads /api/creator/analytics
 * (a fresh Instagram pull); this fallback reshapes the STORED `creators` row so
 * a brand-ready one-pager renders even when the creator hasn't connected an IG
 * account or the token is stale. Same payload shape as analytics (subset the
 * kit reads), tagged `source: 'db'`. Always 200 — `{ connected:false, reason }`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;

  const db = getBolticClient();

  const SELECT = `SELECT id, handle, display_name, bio, profile_photo_url, is_verified,
                         primary_category, primary_city, follower_count, following_count,
                         posts_count, avg_likes, avg_views, engagement_rate,
                         recent_posts, audience_demographics, credibility
                  FROM creators`;

  try {
    let row: MediaKitCreatorRow | null = null;

    if (accountId) {
      const rows = await db.query<MediaKitCreatorRow>(
        `${SELECT}
         WHERE id = (SELECT creator_id FROM connected_accounts WHERE id = $1 LIMIT 1)
         LIMIT 1`,
        [accountId],
      );
      row = rows[0] ?? null;
    } else if (handle) {
      const rows = await db.query<MediaKitCreatorRow>(
        `${SELECT} WHERE LOWER(handle) = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`,
        [handle],
      );
      row = rows[0] ?? null;
    } else {
      const rows = await db.query<MediaKitCreatorRow>(
        `${SELECT}
         WHERE id = (SELECT creator_id FROM connected_accounts WHERE connection_status = 'active'
                     ORDER BY connected_at DESC LIMIT 1)
         LIMIT 1`,
      );
      row = rows[0] ?? null;
    }

    if (!row) {
      return NextResponse.json({ connected: false, reason: 'no_creator' }, { status: 200 });
    }

    return NextResponse.json(buildMediaKit(row));
  } catch (err) {
    return NextResponse.json(
      { connected: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }
}
