import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { liveDiscover, type LiveProfile } from '@/lib/live-discovery';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/discover-live
//   { prompt: string, seeds: string[], depth?: number, max?: number }
//   → { prompt, tokens, seeds, results: LiveProfile[], persisted: number }
//
// Live, login-free Instagram discovery. Crawls public profiles starting from
// the given seed handles, ranks them against the prompt, and best-effort
// persists each into the creators table (source='scrape', tier_c) so the
// directory grows with every search. Persistence never blocks the response.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const seedsIn: unknown = body?.seeds;

  if (prompt.length < 2) {
    return NextResponse.json({ error: 'prompt must be at least 2 characters' }, { status: 400 });
  }
  const seeds = Array.isArray(seedsIn)
    ? seedsIn.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  if (seeds.length === 0) {
    return NextResponse.json(
      { error: 'no_seeds', message: 'At least one seed handle is required.' },
      { status: 422 },
    );
  }

  const depth = clampInt(body?.depth, 1, 3, 2);
  const max = clampInt(body?.max, 5, 80, 40);

  try {
    const run = await liveDiscover(prompt, seeds, { depth, max });
    const persisted = await persist(run.results);
    return NextResponse.json({ ...run, prompt, persisted });
  } catch (err) {
    console.error('[discover-live] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function persist(results: LiveProfile[]): Promise<number> {
  if (results.length === 0) return 0;
  let ok = 0;
  try {
    const db = getBolticClient();
    for (const p of results) {
      try {
        await db.upsert(
          'creators',
          {
            platform: 'instagram',
            handle: p.username,
            profile_url: `https://www.instagram.com/${p.username}/`,
            display_name: p.full_name || null,
            bio: p.biography || null,
            primary_category: p.category || null,
            profile_photo_url: p.profile_pic_url,
            is_verified: p.is_verified,
            follower_count: p.followers || null,
            source: 'scrape',
            data_tier: 'tier_c',
            is_active: true,
            first_indexed_at: new Date().toISOString(),
          },
          ['platform', 'handle'],
        );
        ok++;
      } catch {
        /* skip a single bad row, keep going */
      }
    }
  } catch {
    /* DB unreachable — live results still returned to the user */
  }
  return ok;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN;
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
