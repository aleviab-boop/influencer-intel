import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import {
  liveDiscover,
  resolveNameToSeeds,
  resolveTopicToSeeds,
  tokenize,
  classifyPrompt,
  inferNiche,
  isLocationToken,
  STATE_CITIES,
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
  const mode = body?.mode === 'db' ? 'db' : 'live';

  // Cold-search fallback: when a db-mode (Lander) search finds nothing in the
  // database, we enqueue a deep worker crawl and fall through to an immediate
  // live crawl. This id lets the client poll the worker for the richer finds it
  // tags over the next minute or two.
  let workerJobId: string | null = null;

  // mode 'db' → search only the existing creators database (no live crawl).
  if (mode === 'db') {
    // Lander toggle: 'instagram' = real scraper finds, 'trends' = uploaded
    // Excel/campaign creators. 5K follower floor drops nanos + bad-scrape noise.
    const bucket = body?.bucket === 'trends' ? 'trends' : body?.bucket === 'instagram' ? 'instagram' : undefined;
    const gender = body?.gender === 'female' ? 'female' : body?.gender === 'male' ? 'male' : undefined;
    const dbMatches = await searchCreatorsInDb(tokens, max, { bucket, minFollowers: 5000, gender });
    // Log the agency search for the admin Agency activity feed (best-effort).
    void getBolticClient()
      .insert('agency_searches', { prompt, result_count: dbMatches.length })
      .catch(() => {});
    // A prompt is "cold" when the Super Admin scraper has never crawled it before
    // (no prior search_query job for it) — NOT merely when the DB is empty. This
    // is the key distinction: "fashion influencer in guwahati" returns generic
    // fashion creators from the DB that AREN'T from Guwahati, so a pure empty
    // check would never fire. We instead crawl the first time the exact prompt is
    // searched, to pull genuinely local, on-target creators.
    const searchedBefore = await promptSearchedBefore(prompt);
    if (searchedBefore && dbMatches.length > 0) {
      // Known prompt that's already been crawled → serve the DB instantly, ranked
      // by relevance (and the user's curated list first). The client live-enriches
      // each row's stats lazily as it scrolls into view (via /api/ig-stats).
      const results = leadWithLocals(dbMatches, tokens).slice(0, max);
      return NextResponse.json({
        prompt,
        tokens,
        results,
        from_db: results.length,
        from_live: 0,
        persisted: 0,
        resolved_from_names: [],
        auto_seeds: [],
        job_id: null,
        cold: false,
      });
    }
    // NEW prompt (never crawled by the scraper) → enqueue a deep worker crawl
    // (topsearch + hashtags + chaining across the rotating accounts) so the DB
    // fills for next time, THEN fall through to an immediate live crawl below so
    // the user sees genuinely on-target creators NOW. (If the prompt WAS crawled
    // before but the DB is empty, we skip the duplicate enqueue and just live-crawl.)
    if (!searchedBefore) workerJobId = await enqueueSearchJob(prompt);
    // (intentionally no return — execution continues into the live-first crawl)
  }

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
    // Cold Lander search where the live crawl also came back empty: don't error —
    // the deep worker crawl is already queued, so return an empty set + the job id
    // and let the client poll it as the worker tags fresh finds over the next
    // minute or two.
    if (workerJobId) {
      return NextResponse.json({
        prompt,
        tokens,
        results: [],
        from_db: 0,
        from_live: 0,
        persisted: 0,
        resolved_from_names: resolvedFromNames,
        auto_seeds: autoSeeds,
        job_id: workerJobId,
        cold: true,
        message: 'New search — crawling Instagram now. Fresh creators will appear here shortly.',
      });
    }
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
  // Live mode = "search Instagram" from a username: lead with the crawled
  // network so the searched creator surfaces, then the database fills below.
  // First flag/keep genuine locals for a place query (live finds never carry the
  // DB's geo flag) so a "…in <city>" search never leads with a global mega-account.
  const results = leadWithLocals(Array.from(byUser.values()), tokens)
    .sort((a, b) => {
      // Location-matched creators lead, so a real local creator outranks a
      // bigger non-local one on a "...in <place>" query.
      const am = a.loc_match ? 0 : 1;
      const bm = b.loc_match ? 0 : 1;
      if (am !== bm) return am - bm;
      // Among location matches, the user's own curated/imported creators lead —
      // otherwise reach alone drags scraped mega-celebs above curated locals.
      // (Only applied within the location bucket so plain username crawls, which
      // have no location intent, still surface the crawled network first.)
      if (a.loc_match && b.loc_match) {
        const ac = a.curated ? 0 : 1;
        const bc = b.curated ? 0 : 1;
        if (ac !== bc) return ac - bc;
      }
      const al = a.from === 'live' ? 0 : 1;
      const bl = b.from === 'live' ? 0 : 1;
      if (al !== bl) return al - bl;
      return b.score - a.score || b.followers - a.followers;
    })
    .slice(0, max);

  // Tag saved creators with the search's region/niche. When the prompt has no
  // niche (e.g. a bare seed handle), infer it from the crawled network so a
  // search for one fashion creator still tags the whole network as "fashion".
  const cls = classifyPrompt(prompt);
  const niche = cls.niche ?? inferNiche(liveProfiles.length ? liveProfiles : dbMatches);
  const tags = Array.from(new Set([...cls.tags, ...(niche ? [niche] : [])]));
  const persisted = await persist(liveProfiles, { region: cls.region, niche, tags });

  return NextResponse.json({
    prompt,
    tokens,
    results,
    from_db: results.filter((r) => r.from === 'db').length,
    from_live: results.filter((r) => r.from === 'live').length,
    persisted,
    resolved_from_names: resolvedFromNames,
    auto_seeds: autoSeeds,
    job_id: workerJobId,
    cold: workerJobId != null,
  });
}

// Has the Super Admin scraper ever crawled this exact prompt? A prior
// search_query job (queued or completed) means the DB already reflects a real
// crawl for it, so we serve the DB instead of re-crawling. Case/space-insensitive.
// On DB error we fail SAFE (return true) so a hiccup never triggers a crawl storm.
async function promptSearchedBefore(prompt: string): Promise<boolean> {
  try {
    const rows = await getBolticClient().query<{ one: number }>(
      `SELECT 1 AS one FROM scrape_jobs
        WHERE job_type = 'search_query'
          AND lower(trim(target_handle)) = lower(trim($1))
        LIMIT 1`,
      [prompt],
    );
    return rows.length > 0;
  } catch {
    return true;
  }
}

// Enqueue a deep worker search_query crawl (mirrors /api/crawl-search): a primary
// priority-1 job for the prompt, plus lower-priority sibling-city jobs when the
// prompt names a state, so a cold search fills the DB broadly for next time.
async function enqueueSearchJob(prompt: string): Promise<string | null> {
  const db = getBolticClient();
  let jobId: string | null = null;
  try {
    const job = await db.insert<{ id: string }>('scrape_jobs', {
      job_type: 'search_query',
      target_platform: 'instagram',
      target_handle: prompt,
      priority: 1,
      status: 'queued',
      attempts: 0,
      queued_at: new Date().toISOString(),
    });
    jobId = job.id;
  } catch (err) {
    console.error('[discover-live] enqueue failed:', err);
  }
  // State fan-out: if the prompt names a state, queue its other cities (lower
  // priority) so the whole state gets covered, not just the primary city.
  try {
    const lower = prompt.toLowerCase();
    for (const [state, cities] of Object.entries(STATE_CITIES)) {
      if (!new RegExp(`(^|[^a-z])${state}([^a-z]|$)`).test(lower)) continue;
      for (const city of [...new Set(cities)].slice(1, 4)) {
        const cityPrompt = prompt.replace(new RegExp(state, 'i'), city);
        await db
          .insert('scrape_jobs', {
            job_type: 'search_query',
            target_platform: 'instagram',
            target_handle: cityPrompt,
            priority: 3,
            status: 'queued',
            attempts: 0,
            queued_at: new Date().toISOString(),
          })
          .catch(() => {});
      }
      break;
    }
  } catch (err) {
    console.error('[discover-live] state fan-out failed:', err);
  }
  return jobId;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
}

// For a location query ("...in pondicherry"), make sure genuinely-local creators
// lead and global niche mega-creators don't. Flags loc_match on any result whose
// profile text mentions the place (covers live-crawled finds, which never get the
// DB's geo flag), then — when we have a solid set of locals — returns ONLY them so
// the list isn't topped by a 2.5M global travel account that isn't from the city.
// No-op for queries without a place token.
function leadWithLocals(list: LiveProfile[], tokens: string[]): LiveProfile[] {
  const locTokens = tokens.filter((t) => isLocationToken(t));
  if (locTokens.length === 0) return list;
  const wb = (t: string) => new RegExp(`(^|[^a-z])${t}([^a-z]|$)`);
  for (const p of list) {
    if (!p.loc_match) {
      const text = `${p.username} ${p.full_name} ${p.biography} ${p.category}`.toLowerCase();
      p.loc_match = locTokens.some((t) => wb(t).test(text));
    }
  }
  const locals = list.filter((p) => p.loc_match);
  return locals.length >= 5 ? locals : list;
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
