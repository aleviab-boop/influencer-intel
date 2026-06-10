import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import {
  liveDiscover,
  resolveNameToSeeds,
  resolveTopicToSeeds,
  tokenize,
  classifyPrompt,
  type LiveProfile,
} from '@/lib/live-discovery';
import { searchCreatorsInDb } from '@/lib/creator-db-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/discover-live
//   { prompt, seeds?: string[], names?: string[], depth?, max? }
//   → { prompt, tokens, results, from_db, from_live, persisted, ... }
//
// Live-first discovery. Instagram is the primary search: we always crawl live
// (seeded by explicit handles, names, or handles auto-derived from the prompt)
// and lead with those results. The creators database is supplementary — it
// tops up the live results and surfaces curated profiles below them. New live
// profiles are persisted so the database keeps growing.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

  if (prompt.length < 2) {
    return NextResponse.json({ error: 'prompt must be at least 2 characters' }, { status: 400 });
  }

  const seeds = toStringArray(body?.seeds);
  const names = toStringArray(body?.names);
  const depth = clampInt(body?.depth, 1, 3, 2);
  const max = clampInt(body?.max, 5, 80, 40);
  const tokens = tokenize(prompt);

  // 1. Live-first: Instagram is the primary search. Resolve seeds (explicit
  //    handles, names, or auto-derived from the prompt) and crawl live.
  const resolvedFromNames: Array<{ name: string; handle: string; followers: number }> = [];
  const autoSeeds: Array<{ handle: string; followers: number }> = [];
  let liveProfiles: LiveProfile[] = [];

  for (const name of names) {
    const matches = await resolveNameToSeeds(name);
    for (const m of matches) {
      seeds.push(m.handle);
      resolvedFromNames.push({ name, handle: m.handle, followers: m.followers });
    }
  }
  if (seeds.length === 0 && names.length === 0) {
    for (const m of await resolveTopicToSeeds(prompt)) {
      seeds.push(m.handle);
      autoSeeds.push({ handle: m.handle, followers: m.followers });
    }
  }

  const uniqueSeeds = Array.from(new Set(seeds.map((s) => s.trim()).filter(Boolean)));
  if (uniqueSeeds.length > 0) {
    try {
      const run = await liveDiscover(prompt, uniqueSeeds, { depth, max });
      liveProfiles = run.results.map((r) => ({ ...r, from: 'live' as const }));
    } catch (err) {
      console.error('[discover-live] crawl failed:', err);
    }
  }

  // 2. Database is supplementary — used to top up the live results.
  const dbMatches = await searchCreatorsInDb(tokens, max);

  // 3. Nothing anywhere → ask for a starting point.
  if (dbMatches.length === 0 && liveProfiles.length === 0) {
    return NextResponse.json(
      {
        error: 'no_seeds',
        message:
          names.length > 0
            ? `Couldn't find Instagram accounts for that name. Try a different spelling or an @handle.`
            : `Couldn't find live results or anything in your database. Add a name or @handle to start from.`,
      },
      { status: 422 },
    );
  }

  // 4. Merge live + database and rank by genuine quality — relevance to the
  //    prompt first, then reach (followers) — regardless of source. Dedupe by
  //    handle, keeping the higher-scored / richer row.
  const byUser = new Map<string, LiveProfile>();
  for (const p of [...liveProfiles, ...dbMatches]) {
    const key = p.username.toLowerCase();
    const ex = byUser.get(key);
    if (!ex || p.score > ex.score || (p.score === ex.score && p.followers > ex.followers)) {
      byUser.set(key, p);
    }
  }
  const results = Array.from(byUser.values())
    .sort((a, b) => b.score - a.score || b.followers - a.followers)
    .slice(0, max);

  const persisted = await persist(liveProfiles, classifyPrompt(prompt));

  return NextResponse.json({
    prompt,
    tokens,
    results,
    from_db: results.filter((r) => r.from === 'db').length,
    from_live: results.filter((r) => r.from === 'live').length,
    persisted,
    resolved_from_names: resolvedFromNames,
    auto_seeds: autoSeeds,
  });
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
}

async function persist(
  results: LiveProfile[],
  ctx: { region: string | null; niche: string | null; tags: string[] },
): Promise<number> {
  if (results.length === 0) return 0;
  const hasTag = Boolean(ctx.region || ctx.niche || ctx.tags.length);
  let ok = 0;
  try {
    const db = getBolticClient();
    for (const p of results) {
      try {
        const row = await db.upsert<{ id: string }>(
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
            // store the freshly computed engagement (as a ratio) when we have it
            ...(p.engagement > 0 ? { engagement_rate: p.engagement / 100 } : {}),
            source: 'scrape',
            data_tier: 'tier_c',
            is_active: true,
            first_indexed_at: new Date().toISOString(),
          },
          ['platform', 'handle'],
        );
        if (row?.id) {
          p.creator_id = row.id; // so the client can recruit it
          // Tag with the search's niche/region — fill-only, never clobbering
          // curated data, so these creators are findable in future searches.
          if (hasTag) {
            await db.query(
              `UPDATE creators SET
                 genre  = COALESCE(genre,  $2),
                 niche  = COALESCE(niche,  $3),
                 region = COALESCE(region, $4),
                 tags   = CASE WHEN tags IS NULL OR cardinality(tags) = 0
                               THEN $5::text[] ELSE tags END
               WHERE id = $1`,
              [row.id, ctx.niche, ctx.niche, ctx.region, ctx.tags],
            );
          }
        }
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
