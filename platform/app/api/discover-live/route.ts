import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import {
  liveDiscover,
  resolveNameToSeeds,
  resolveTopicToSeeds,
  tokenize,
  type LiveProfile,
} from '@/lib/live-discovery';
import { searchCreatorsInDb } from '@/lib/creator-db-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

// If the DB already has at least this many matches, skip the live crawl
// entirely (fast path). Below it, we crawl Instagram to top up.
const ENOUGH_FROM_DB = 20;

// POST /api/discover-live
//   { prompt, seeds?: string[], names?: string[], depth?, max? }
//   → { prompt, tokens, results, from_db, from_live, persisted, ... }
//
// DB-first, live-fill discovery. We first check the connected creators table
// for matches (instant). If that's enough — or the caller gave no explicit
// seed — we may skip the crawl. Otherwise we crawl Instagram live (seeded by
// handles, names, or auto-derived from the prompt), merge, rank, and persist
// the new profiles so the next identical search is faster.
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

  // 1. DB-first: what do we already have?
  const dbMatches = await searchCreatorsInDb(tokens, max);

  const explicit = seeds.length > 0 || names.length > 0;
  const needLive = explicit || dbMatches.length < ENOUGH_FROM_DB;

  // 2. Live-fill (only when needed).
  const resolvedFromNames: Array<{ name: string; handle: string; followers: number }> = [];
  const autoSeeds: Array<{ handle: string; followers: number }> = [];
  let liveProfiles: LiveProfile[] = [];

  if (needLive) {
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
  }

  // 3. Nothing anywhere → ask for a starting point.
  if (dbMatches.length === 0 && liveProfiles.length === 0) {
    return NextResponse.json(
      {
        error: 'no_seeds',
        message:
          names.length > 0
            ? `Couldn't find Instagram accounts for that name. Try a different spelling or an @handle.`
            : `Nothing in your database yet and couldn't auto-find a starting point. Add a name or @handle to start from.`,
      },
      { status: 422 },
    );
  }

  // 4. Merge DB + live, dedupe by handle (keep the higher score), rank.
  const byUser = new Map<string, LiveProfile>();
  for (const p of [...dbMatches, ...liveProfiles]) {
    const key = p.username.toLowerCase();
    const ex = byUser.get(key);
    if (!ex || p.score > ex.score) byUser.set(key, p);
  }
  const results = Array.from(byUser.values())
    .sort((a, b) => b.score - a.score || b.followers - a.followers)
    .slice(0, max);

  const persisted = await persist(liveProfiles);

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
