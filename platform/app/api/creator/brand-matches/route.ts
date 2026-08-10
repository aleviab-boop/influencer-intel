import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { matchBrands } from '@/lib/brand-match';
import type { ProgramCandidate } from '@/lib/brand-match';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';

/**
 * GET /api/creator/brand-matches?account=<id>|?handle=<h>
 *
 * "Brands you should pitch" — ranks the DB's active recruitment programs
 * against the creator's niche + content topics. DB-only (no IG token) so it
 * renders even when the Instagram connection is stale. Always 200; an empty
 * `matches` array with a reason drives a friendly empty state.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const db = getBolticClient();

  try {
    // Session-first identity: a logged-in creator only ever sees their own matches.
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) {
      return NextResponse.json({ available: false, reason: 'no_creator', matches: [] }, { status: 200 });
    }

    // Creator's niche + interest signal (bio + category).
    const cr = await db.query<{ primary_category: string | null; vision_niche: string | null; bio: string | null }>(
      `SELECT primary_category, raw_metadata->'vision'->>'niche' AS vision_niche, bio
         FROM creators WHERE id = $1 LIMIT 1`,
      [creatorId],
    );
    const niche = (cr[0]?.primary_category ?? cr[0]?.vision_niche ?? '').trim() || null;
    const interests = [cr[0]?.vision_niche ?? '', cr[0]?.bio ?? ''].filter(Boolean);

    // Active programs the creator is NOT already engaged with (any non-declined
    // recruit counts as "already in the pipeline").
    const rows = await db.query<ProgramCandidate>(
      `SELECT p.id AS program_id, p.name AS program_name, p.description,
              b.name AS brand_name, b.category AS brand_category
         FROM programs p
         LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM program_recruits pr
             WHERE pr.program_id = p.id AND pr.creator_id = $1 AND pr.status <> 'declined'
          )
        ORDER BY p.created_at DESC
        LIMIT 100`,
      [creatorId],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { available: false, reason: 'no_programs', niche, matches: [] }, { status: 200 },
      );
    }

    const matches = matchBrands(niche, interests, rows, 6);

    return NextResponse.json({ available: true, niche, matches }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message, matches: [] },
      { status: 200 },
    );
  }
}
