import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import {
  liveDiscover,
  resolveNameToSeeds,
  resolveTopicToSeeds,
  profilesFromHandles,
  tokenize,
  classifyPrompt,
  inferNiche,
  isLocationToken,
  completenessScore,
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
      // by relevance (locals + curated first, from the SQL order). The client
      // live-enriches each row's stats lazily as it scrolls into view.
      const results = flagLocals(dbMatches, tokens)
        .slice(0, max)
        .map((p) => ({ ...p, completeness: completenessScore(p) }));
      const place = extractPlace(prompt, tokens);
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
        place,
        localsFound: place ? countLocals(results, place) : null,
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

  // 1. Live-first: Instagram is the primary search. The AI-suggest pipeline and
  //    the live-crawl pipeline are independent, so we run them CONCURRENTLY on
  //    tight budgets to stay well under Vercel's 60s function limit.
  const resolvedFromNames: Array<{ name: string; handle: string; followers: number }> = [];
  const autoSeeds: Array<{ handle: string; followers: number }> = [];
  let liveProfiles: LiveProfile[] = [];
  let aiProfiles: LiveProfile[] = [];

  // Explicit @handles from a typed name resolve first (fast, rarely used).
  for (const name of names) {
    for (const m of await resolveNameToSeeds(name)) {
      seeds.push(m.handle);
      resolvedFromNames.push({ name, handle: m.handle, followers: m.followers });
    }
  }

  const withTimeout = <T,>(p: Promise<T>, ms: number, fb: T): Promise<T> =>
    Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fb), ms))]);

  // Pipeline A — OpenAI web-search names real handles for the niche+location;
  // each is validated against Instagram (hallucinations dropped, throttled ones
  // kept as stubs). Only on Lander (db-mode) searches.
  const aiPipeline = (async () => {
    if (mode !== 'db') return;
    try {
      const handles = await withTimeout(
        getOpenAIClient().suggestHandlesFromPrompt(prompt, 15).catch(() => [] as string[]),
        18_000,
        [] as string[],
      );
      if (handles.length === 0) return;
      let cand = (await profilesFromHandles(handles, tokens, { max: 10, budgetMs: 13_000, delayMs: 300 })).map(
        (p) => ({ ...p, from: 'live' as const }),
      );
      // OpenAI relevance check: web-search suggestions sometimes include an
      // off-niche account (a makeup artist for an "aquascaping" query) or a
      // foreign one — validation confirms they EXIST but not that they FIT. One
      // cheap classification pass over the fetched bios drops the mismatches.
      // Fail-open (empty verdict → keep all); thin/empty stubs default to keep.
      try {
        const verdict = await withTimeout(
          getOpenAIClient().verifyProfileRelevance(
            prompt,
            cand.map((p) => ({ handle: p.username, name: p.full_name, bio: p.biography, category: p.category })),
          ),
          8_000,
          {} as Record<string, boolean>,
        );
        if (Object.keys(verdict).length > 0) {
          cand = cand.filter((p) => verdict[p.username.toLowerCase()] !== false);
        }
      } catch (err) {
        console.error('[discover-live] AI relevance verify failed:', err);
      }
      aiProfiles = cand;
    } catch (err) {
      console.error('[discover-live] AI suggest failed:', err);
    }
  })();

  // Pipeline B — resolve topic seeds (handle-guessing) and crawl their network.
  const crawlPipeline = (async () => {
    if (seeds.length === 0 && names.length === 0) {
      for (const m of await resolveTopicToSeeds(prompt, { budgetMs: 9_000 })) {
        seeds.push(m.handle);
        autoSeeds.push({ handle: m.handle, followers: m.followers });
      }
    }
    const uniqueSeeds = Array.from(new Set(seeds.map((s) => s.trim()).filter(Boolean)));
    if (uniqueSeeds.length === 0) return;
    try {
      const run = await liveDiscover(prompt, uniqueSeeds, { depth, max, budgetMs: 15_000 });
      liveProfiles = run.results.map((r) => ({ ...r, from: 'live' as const }));
    } catch (err) {
      console.error('[discover-live] crawl failed:', err);
    }
  })();

  await Promise.all([aiPipeline, crawlPipeline]);

  // 2. Database is supplementary — used to top up the live results.
  const dbMatches = await searchCreatorsInDb(tokens, max);

  // 3. Nothing anywhere → ask for a starting point.
  if (dbMatches.length === 0 && liveProfiles.length === 0 && aiProfiles.length === 0) {
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

  // 4. Merge + rank by SOURCE PRIORITY. On the Lander (db mode) the order is
  //    ① OpenAI-found ▸ ② database ▸ ③ live crawl. On the scraper page (live/
  //    username mode) the crawled network still leads, DB fills below.
  //    Dedupe by handle — keep the AI marker if any source was AI, and the
  //    richer (higher-follower / higher-score) row's data.
  const srcRank = (p: LiveProfile): number =>
    mode === 'db'
      ? p.from_ai ? 0 : p.from === 'db' ? 1 : 2
      : p.from === 'live' ? 0 : 1;
  const byUser = new Map<string, LiveProfile>();
  for (const p of [...aiProfiles, ...dbMatches, ...liveProfiles]) {
    const key = p.username.toLowerCase();
    const ex = byUser.get(key);
    if (!ex) {
      byUser.set(key, p);
      continue;
    }
    const richer = p.followers > ex.followers || (p.followers === ex.followers && p.score > ex.score) ? p : ex;
    byUser.set(key, { ...richer, from_ai: p.from_ai || ex.from_ai, loc_match: p.loc_match || ex.loc_match });
  }
  const results = flagLocals(Array.from(byUser.values()), tokens)
    .sort((a, b) => {
      // ① Source priority: OpenAI first, then DB, then live crawl.
      const sr = srcRank(a) - srcRank(b);
      if (sr !== 0) return sr;
      // ② Within a source, genuine locals lead a "…in <place>" query.
      const am = a.loc_match ? 0 : 1;
      const bm = b.loc_match ? 0 : 1;
      if (am !== bm) return am - bm;
      // ③ Curated (user's own imported list) next.
      const ac = a.curated ? 0 : 1;
      const bc = b.curated ? 0 : 1;
      if (ac !== bc) return ac - bc;
      // ④ Then relevance, then reach.
      return b.score - a.score || b.followers - a.followers;
    })
    .slice(0, max)
    .map((p) => ({ ...p, completeness: completenessScore(p) }));

  // Tag saved creators with the search's region/niche. When the prompt has no
  // niche (e.g. a bare seed handle), infer it from the crawled network so a
  // search for one fashion creator still tags the whole network as "fashion".
  const cls = classifyPrompt(prompt);
  const niche = cls.niche ?? inferNiche(liveProfiles.length ? liveProfiles : dbMatches);
  const tags = Array.from(new Set([...cls.tags, ...(niche ? [niche] : [])]));
  // Persist EVERY creator surfaced by the search — AI-found (verified AND
  // unverified), plus crawled — so the DB keeps building in the background. The
  // unverified ones (IG was throttled/timed out, so we couldn't confirm them
  // this run) are stored fill-only inside persist(), so their empty fields can
  // never clobber a real existing row; a later search / worker crawl enriches them.
  const persisted = await persist(
    [...aiProfiles, ...liveProfiles],
    { region: cls.region, niche, tags },
  );

  const place = extractPlace(prompt, tokens);
  return NextResponse.json({
    prompt,
    tokens,
    results,
    from_db: results.filter((r) => r.from === 'db').length,
    from_live: results.filter((r) => r.from === 'live').length,
    from_ai: aiProfiles.length,
    persisted,
    resolved_from_names: resolvedFromNames,
    auto_seeds: autoSeeds,
    job_id: workerJobId,
    cold: workerJobId != null,
    place,
    localsFound: place ? countLocals(results, place) : null,
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

// The place a location query targets: a known city token, else the word after
// "…in <place>" (covers small towns not in our city list, e.g. "…in varkala").
function extractPlace(prompt: string, tokens: string[]): string | null {
  const known = tokens.find((t) => isLocationToken(t));
  if (known) return known;
  const m = prompt.toLowerCase().match(/\bin\s+([a-z][a-z]{2,})\b\s*$/);
  return m?.[1] ?? null;
}

// How many results are genuinely FROM the place — loc_match (geo/DB) or the place
// word appearing in the profile text. Lets the UI warn "no locals found, showing
// the broader niche" when a location search has zero true-local results.
function countLocals(results: LiveProfile[], place: string): number {
  const wb = new RegExp(`(^|[^a-z])${place}([^a-z]|$)`);
  return results.filter(
    (r) => r.loc_match || wb.test(`${r.username} ${r.full_name} ${r.biography} ${r.category}`.toLowerCase()),
  ).length;
}

// For a location query ("...in pondicherry"), flag loc_match on any result whose
// profile text mentions the place (covers live-crawled finds, which never carry
// the DB's geo flag) so genuine locals lead the ranking instead of a global niche
// mega-account. Callers sort loc_match first, so this just guarantees the flag is
// set consistently across DB + live results. No-op for queries without a place.
function flagLocals(list: LiveProfile[], tokens: string[]): LiveProfile[] {
  const locTokens = tokens.filter((t) => isLocationToken(t));
  if (locTokens.length === 0) return list;
  const wb = (t: string) => new RegExp(`(^|[^a-z])${t}([^a-z]|$)`);
  for (const p of list) {
    if (!p.loc_match) {
      const text = `${p.username} ${p.full_name} ${p.biography} ${p.category}`.toLowerCase();
      p.loc_match = locTokens.some((t) => wb(t).test(text));
    }
  }
  return list;
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
        let id: string | undefined;
        const cscore = completenessScore(p); // 0–10, stored so it's queryable/sortable
        if (p.unverified) {
          // Unverified AI find — IG was throttled / timed out, so it's plausibly
          // real but unconfirmed this run. Store the handle so it lands in the DB
          // (findable + enrichable in the background), but FILL-ONLY: on conflict
          // we COALESCE, so an empty stub can never overwrite a real row's data.
          // followers/bio/engagement are left unset for a later real scrape.
          const rows = await db.query<{ id: string }>(
            `INSERT INTO creators
               (platform, handle, profile_url, display_name, primary_category,
                profile_photo_url, is_verified, data_completeness, source, data_tier, is_active, first_indexed_at)
             VALUES ('instagram', $1, $2, $3, $4, $5, $6, $7, 'scrape', 'tier_c', true, NOW())
             ON CONFLICT (platform, handle) DO UPDATE SET
               display_name      = COALESCE(creators.display_name, EXCLUDED.display_name),
               primary_category  = COALESCE(creators.primary_category, EXCLUDED.primary_category),
               profile_photo_url = COALESCE(creators.profile_photo_url, EXCLUDED.profile_photo_url),
               -- keep the richer completeness score (a later enrichment only raises it)
               data_completeness = GREATEST(COALESCE(creators.data_completeness, 0), EXCLUDED.data_completeness)
             RETURNING id`,
            [
              p.username,
              `https://www.instagram.com/${p.username}/`,
              p.full_name || null,
              p.category || null,
              p.profile_pic_url,
              p.is_verified,
              cscore,
            ],
          );
          id = rows[0]?.id;
        } else {
          // Verified / crawled creator — full fresh data, safe to refresh the row.
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
              data_completeness: cscore,
              source: 'scrape',
              data_tier: 'tier_c',
              is_active: true,
              first_indexed_at: new Date().toISOString(),
            },
            ['platform', 'handle'],
          );
          id = row?.id;
        }
        if (id) {
          p.creator_id = id; // so the client can recruit it
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
              [id, ctx.niche, ctx.niche, ctx.region, ctx.tags],
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
