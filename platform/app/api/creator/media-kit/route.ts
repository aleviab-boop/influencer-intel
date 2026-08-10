import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { buildMediaKit, type MediaKitCreatorRow } from '@/lib/media-kit-builder';
import { resolveCreatorId } from '@/lib/creator-identity';

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
  const db = getBolticClient();

  const SELECT = `SELECT id, handle, display_name, bio, profile_photo_url, is_verified,
                         primary_category, primary_city, follower_count, following_count,
                         posts_count, avg_likes, avg_views, engagement_rate,
                         recent_posts, audience_demographics, credibility
                  FROM creators`;

  try {
    // Session-first identity: a logged-in creator only ever sees their own kit.
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) {
      return NextResponse.json({ connected: false, reason: 'no_creator' }, { status: 200 });
    }

    const rows = await db.query<MediaKitCreatorRow>(`${SELECT} WHERE id = $1 LIMIT 1`, [creatorId]);
    const row = rows[0] ?? null;
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
