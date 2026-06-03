// ============================================================
// Similar-creator search via vector similarity.
// Returns the N creators in our DB whose content_embedding is closest
// to the seed creator's embedding. Used for "looks like @handle" UX.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { Creator } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(3, Number(url.searchParams.get('limit') ?? 12)));

  const db = getBolticClient();
  const seed = await db.query<Creator & { content_embedding: number[] | string | null }>(
    `SELECT * FROM creators WHERE LOWER(handle) = LOWER($1) LIMIT 1`,
    [handle],
  );
  if (seed.length === 0) return NextResponse.json({ error: 'creator not found' }, { status: 404 });
  const seedRow = seed[0]!;
  if (!seedRow.content_embedding) {
    return NextResponse.json({ error: 'seed has no embedding (not deep-scraped yet)' }, { status: 422 });
  }

  // pgvector cosine search, excluding the seed itself.
  const embeddingArray = Array.isArray(seedRow.content_embedding)
    ? seedRow.content_embedding
    : null;
  if (!embeddingArray) {
    return NextResponse.json({ error: 'seed embedding malformed' }, { status: 500 });
  }

  const similar = await db.vectorSearch<Creator & { similarity: number }>(
    'creators',
    'content_embedding',
    embeddingArray,
    limit + 1, // +1 because seed will be returned at top
    {
      sql: 'is_active = true AND id != $1',
      params: [seedRow.id],
    },
  );

  return NextResponse.json({
    seed: {
      handle: seedRow.handle,
      display_name: seedRow.display_name,
      follower_count: seedRow.follower_count,
      profile_photo_url: seedRow.profile_photo_url,
    },
    similar: similar.slice(0, limit).map((c) => ({
      id: c.id,
      handle: c.handle,
      display_name: c.display_name,
      profile_photo_url: c.profile_photo_url,
      follower_count: c.follower_count,
      primary_category: c.primary_category,
      primary_city: c.primary_city,
      is_verified: c.is_verified,
      similarity: c.similarity,
      bio: c.bio,
    })),
  });
}
