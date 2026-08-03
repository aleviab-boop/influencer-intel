import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import {
  liveDiscover,
  resolveNameToSeeds,
  resolveTopicToSeeds,
  resolveHashtagToSeeds,
  isCampaignPrompt,
  campaignKey,
  profilesFromHandles,
  enrichHandlesViaApifyBatch,
  tokenize,
  classifyPrompt,
  inferNiche,
  isLocationToken,
  nicheKeywords,
  hasNicheEvidence,
  completenessScore,
  extractContact,
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

// Data-backed lookup for OpenAI-suggested handles: any that already exist in our
// creators DB (with real follower data) come back INSTANTLY and deterministically
// — no live IG fetch, no throttle, and the same every run. This is what lets the
// "AI web search" section reliably fill up to ~10 accounts and stay stable across
// refreshes, instead of depending on how many handles happen to validate live.
async function dbBackedAiProfiles(handles: string[]): Promise<LiveProfile[]> {
  const norm = Array.from(
    new Set(handles.map((h) => h.trim().toLowerCase().replace(/^@/, '')).filter((h) => /^[a-z0-9._]{2,30}$/.test(h))),
  );
  if (norm.length === 0) return [];
  // Also match ignoring dots/underscores: OpenAI often writes "subko_coffee"
  // while the DB has "subkocoffee" (or vice-versa). Matching the stripped form
  // catches those punctuation variants so more of OpenAI's real suggestions
  // resolve from the DB instead of needing a (throttle-prone) live confirm.
  const stripped = Array.from(new Set(norm.map((h) => h.replace(/[._]/g, ''))));
  try {
    const rows = await getBolticClient().query<{
      id: string; handle: string; display_name: string | null; bio: string | null;
      primary_category: string | null; follower_count: number | string | null;
      engagement_rate: number | string | null; is_verified: boolean | null;
      profile_photo_url: string | null; gender: string | null; is_indian: boolean | null;
    }>(
      `SELECT id, handle, display_name, bio, primary_category, follower_count, engagement_rate,
              is_verified, profile_photo_url, gender, is_indian
         FROM creators
        WHERE platform = 'instagram' AND is_active = true
          AND coalesce(follower_count, 0) > 0
          AND (lower(handle) = ANY($1)
               OR regexp_replace(lower(handle), '[._]', '', 'g') = ANY($2))`,
      [norm, stripped],
    );
    return rows.map((r) => {
      const contact = extractContact(r.bio);
      return {
        username: r.handle,
        full_name: r.display_name ?? '',
        biography: r.bio ?? '',
        category: r.primary_category ?? '',
        followers: Number(r.follower_count ?? 0),
        is_private: false,
        is_verified: Boolean(r.is_verified),
        profile_pic_url: r.profile_photo_url ?? null,
        score: 1,
        engagement: r.engagement_rate != null ? Math.round(Number(r.engagement_rate) * 1000) / 10 : 0,
        email: contact.email,
        phone: contact.phone,
        link: contact.link,
        creator_id: r.id,
        from: 'live' as const,
        from_ai: true,
        gender: (r.gender === 'female' || r.gender === 'male' ? r.gender : null) as 'female' | 'male' | null,
        is_indian: r.is_indian === false ? false : true,
      } as LiveProfile;
    });
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  // Wall-clock start. Campaign discovery chains TWO sequential Apify phases
  // (hashtag discovery → batched profile enrichment); each is ~20-35s. We budget
  // the enrichment against a hard deadline measured from here so the pair always
  // lands inside the route's 60s maxDuration instead of 504-ing when phase 1 runs
  // long.
  const t0 = Date.now();
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
  const isCampaign = isCampaignPrompt(prompt);

  // DIRECT-HANDLE LOOKUP. Rule: a prompt that starts with '@' names an exact
  // Instagram account, not a niche. We turn it into a crawl seed so the live
  // pipeline FETCHES that profile (and its network) instead of keyword-searching
  // the DB for it. For a handle lookup we also skip the OpenAI-suggest step, the
  // niche relevance gate, and the deep-worker enqueue — none of those apply when
  // the user has already told us the exact account they want.
  const handleLookup = /^@[a-z0-9._]{1,30}$/i.test(prompt);
  const lookupHandle = handleLookup ? prompt.slice(1).toLowerCase() : '';
  if (handleLookup && !seeds.some((s) => s.trim().toLowerCase().replace(/^@/, '') === lookupHandle)) {
    seeds.push(lookupHandle);
  }

  // Cold-search fallback: when a db-mode (Lander) search finds nothing in the
  // database, we enqueue a deep worker crawl and fall through to an immediate
  // live crawl. This id lets the client poll the worker for the richer finds it
  // tags over the next minute or two.
  let workerJobId: string | null = null;
  // Hoisted so the crawl pipeline below can read it. A prompt is "cold" the first
  // time it's searched. Flow: OpenAI web search + DB run on EVERY search; the live
  // Instagram crawl runs ONLY on a cold (never-searched) prompt.
  let searchedBefore = false;

  // mode 'db' → search only the existing creators database (no live crawl).
  if (mode === 'db') {
    // Lander toggle: 'instagram' = real scraper finds, 'trends' = uploaded
    // Excel/campaign creators. 5K follower floor drops nanos + bad-scrape noise.
    const bucket = body?.bucket === 'trends' ? 'trends' : body?.bucket === 'instagram' ? 'instagram' : undefined;
    const gender = body?.gender === 'female' ? 'female' : body?.gender === 'male' ? 'male' : undefined;
    const dbMatches = await searchCreatorsInDb(tokens, max, { bucket, minFollowers: 5000, gender });
    // Log the agency search for the admin Agency activity feed (best-effort).
    // Raw query (not db.insert): the client casts JS arrays to ::jsonb, but
    // agency_searches.tokens is text[] — pg encodes a string[] param natively.
    // Storing tokens powers the admin Metrics "top niches" rollup.
    void getBolticClient()
      .query(`INSERT INTO agency_searches (prompt, tokens, result_count) VALUES ($1, $2, $3)`, [prompt, tokens, dbMatches.length])
      .catch(() => {});

    // TRENDS is a CURATED bucket — the creators imported from the campaign Excel
    // sheets — so it must be an instant DB read and NOTHING else. It must never
    // trigger a live Instagram crawl, an OpenAI web search, or a worker job
    // (those are the Instagram bucket's job). Return the curated matches straight
    // away so pressing "Trends" shows the sheet immediately instead of crawling.
    if (bucket === 'trends') {
      const place0 = extractPlace(prompt, tokens);
      const trendsResults = flagLocals(dbMatches, tokens)
        .filter((p) => p.followers > 0 && !p.unverified)
        .sort((a, b) => {
          const am = a.loc_match ? 0 : 1;
          const bm = b.loc_match ? 0 : 1;
          if (am !== bm) return am - bm;
          return b.score - a.score || b.followers - a.followers;
        })
        .slice(0, max)
        .map((p) => ({ ...p, completeness: completenessScore(p) }));
      return NextResponse.json({
        prompt,
        tokens,
        results: trendsResults,
        from_db: trendsResults.length,
        from_live: 0,
        from_ai: 0,
        persisted: 0,
        resolved_from_names: [],
        auto_seeds: [],
        job_id: null,
        cold: false,
        place: place0,
        localsFound: place0 ? countLocals(trendsResults, place0) : null,
      });
    }

    // FAST PHASE: the client fires a `dbOnly` call first so the page shows DB
    // results in ~1s, then a second full call streams in the (slow ~15s) OpenAI +
    // live-crawl results. Without this the whole page blocks on OpenAI's web
    // search and shows a 15-30s blank spinner. dbOnly skips AI/crawl/persist/
    // enqueue entirely — pure DB read, returned immediately.
    if (body?.dbOnly === true) {
      const placeF = extractPlace(prompt, tokens);
      const fast = flagLocals(dbMatches, tokens)
        .filter((p) => p.followers > 0 && !p.unverified)
        .sort((a, b) => {
          const am = a.loc_match ? 0 : 1;
          const bm = b.loc_match ? 0 : 1;
          if (am !== bm) return am - bm;
          return b.score - a.score || b.followers - a.followers;
        })
        .slice(0, max)
        .map((p) => ({ ...p, completeness: completenessScore(p) }));
      return NextResponse.json({
        prompt,
        tokens,
        results: fast,
        enriching: [],
        from_db: fast.length,
        from_live: 0,
        from_ai: 0,
        persisted: 0,
        resolved_from_names: [],
        auto_seeds: [],
        job_id: null,
        cold: false,
        partial: true,
        place: placeF,
        localsFound: placeF ? countLocals(fast, placeF) : null,
      });
    }

    // A prompt is "cold" when the Super Admin scraper has never crawled it before
    // (no prior search_query job for it) — NOT merely when the DB is empty. This
    // is the key distinction: "fashion influencer in guwahati" returns generic
    // fashion creators from the DB that AREN'T from Guwahati, so a pure empty
    // check would never fire. We instead crawl the first time the exact prompt is
    // searched, to pull genuinely local, on-target creators.
    // A campaign brief is identified by its canonical key, so any re-wording of
    // the same brief ("influencers for durga puja campaign" vs "creators for durga
    // puja campaign") counts as ALREADY searched — and is served from the DB the
    // second time instead of re-scraping. Non-campaign prompts match exactly.
    searchedBefore = isCampaign
      ? await campaignSearchedBefore(prompt)
      : await promptSearchedBefore(prompt);
    // OpenAI web search + the DB now run on EVERY search (below) — so AI-found
    // creators show even for repeat prompts, and even when the account/relay side
    // is throttled (the OpenAI suggester doesn't depend on IG accounts, so it
    // "never dies"). We only enqueue a deep worker crawl for a genuinely NEW
    // NON-campaign prompt: campaigns fill the DB synchronously via the Apify crawl
    // below and then cache their key, so they don't need the worker.
    if (!searchedBefore && !handleLookup && !isCampaign) workerJobId = await enqueueSearchJob(prompt);
    // (no early return — execution continues into the AI + crawl pipelines)
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
    if (mode !== 'db' || handleLookup) return;
    // The OpenAI suggester runs on EVERY db-mode search, including repeat
    // campaigns — the AI-named creators are the headline (ChatGPT-style) result the
    // user wants, so we never suppress them for caching's sake.
    try {
      // Ask for MORE than 10 so that after relevance-filtering we still have
      // enough to fill the section (OpenAI over-suggests; some don't fit).
      const handles = await withTimeout(
        getOpenAIClient().suggestHandlesFromPrompt(prompt, 20).catch(() => [] as string[]),
        18_000,
        [] as string[],
      );
      if (handles.length === 0) return;

      // DB-FIRST: handles we already have (with real data) resolve instantly and
      // deterministically. Only the handles NOT in the DB need a live IG fetch —
      // far fewer, so validation finishes within budget and barely touches the
      // account pool. This is what makes the AI section reliably ~10 and stable.
      const dbBacked = await dbBackedAiProfiles(handles);
      const haveHandles = new Set(dbBacked.map((p) => p.username.toLowerCase()));
      const missing = handles.filter((h) => !haveHandles.has(h.trim().toLowerCase().replace(/^@/, '')));
      let liveValidated = (
        await profilesFromHandles(missing, tokens, { max: 10, budgetMs: 13_000, delayMs: 300 })
      ).map((p) => ({ ...p, from: 'live' as const }));

      // Free path throttled? Any AI handle that came back as a 0-follower STUB is a
      // real creator GPT found that we just couldn't confirm live. Batch-enrich the
      // stubs through ONE Apify run so they show with real numbers instead of being
      // dropped by the followers>0 display filter — this is what makes a campaign /
      // cold search return the ChatGPT-style named-creator page. Bounded to a single
      // paid run; only fires when the free pool is down (no stubs → no Apify spend).
      const stubHandles = liveValidated.filter((p) => p.unverified).map((p) => p.username);
      if (stubHandles.length > 0) {
        try {
          const enriched = await enrichHandlesViaApifyBatch(stubHandles, tokens, 22_000);
          if (enriched.length > 0) {
            const byHandle = new Map(
              enriched.map((p) => [p.username.toLowerCase(), { ...p, from: 'live' as const }]),
            );
            liveValidated = liveValidated.map((p) => byHandle.get(p.username.toLowerCase()) ?? p);
          }
        } catch (err) {
          console.error('[discover-live] AI Apify batch-enrich failed:', err);
        }
      }

      // Merge, DB-backed first (data-backed + stable), then live finds. Dedupe.
      const merged = new Map<string, LiveProfile>();
      for (const p of [...dbBacked, ...liveValidated]) {
        const k = p.username.toLowerCase();
        if (!merged.has(k)) merged.set(k, p);
      }
      let cand = Array.from(merged.values());
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
    // Live Instagram crawl / Apify discovery runs ONLY for a cold prompt (campaign
    // or otherwise). Once a prompt — or, for a campaign, its canonical key — has
    // been searched, the creators it found are already in the DB, so a repeat is
    // served from the DB instead of re-scraping. This is what makes "search durga
    // puja campaign twice → same results, no second scrape" work.
    if (mode === 'db' && searchedBefore && !handleLookup) return;
    // Campaigns are served ENTIRELY by the AI pipeline (OpenAI names the creators →
    // validate live → Apify batch-enrich the stubs). Running the heavy apifyDirect
    // crawl here in parallel too — a second OpenAI suggest PLUS a ~50s Apify batch —
    // pushed the function past Vercel's 60s kill (the 504). The AI pipeline alone
    // already returns the ChatGPT-style named-creator page the user wants, so for
    // campaigns we skip this crawl and let the AI pipeline carry the result. Explicit
    // @handle lookups still crawl (handleLookup short-circuits the campaign check).
    if (isCampaign && !handleLookup) return;
    if (seeds.length === 0 && names.length === 0) {
      // Campaign/brand-brief prompts are pure DISCOVERY intent. The free handle-
      // guessing is slow AND can return junk handles that satisfy seeds.length>0
      // and thereby BLOCK the far-better hashtag path. So for campaign prompts we
      // skip the guess and go straight to Apify hashtag discovery (wider coverage:
      // more tags, more posts). Non-campaign prompts keep the free-first behaviour.
      const campaign = isCampaignPrompt(prompt);
      if (campaign) {
        // OpenAI-FIRST for campaigns. The web-search suggester names REAL Indian
        // creators for the brief (Komal Pandey, Juhi Godambe, thatbohogirl…) — the
        // same list ChatGPT returns. Seed the crawl with THEM so the Apify batch
        // below enriches the right accounts, instead of #denim global thrift shops.
        // (The bare hashtag path pulled foreign resale/thrift stores and starved
        // this AI stage under the request ceiling — that's what returned junk.)
        try {
          const aiSeeds = await getOpenAIClient()
            .suggestHandlesFromPrompt(prompt, 20)
            .catch(() => [] as string[]);
          for (const h of aiSeeds) {
            seeds.push(h);
            autoSeeds.push({ handle: h, followers: 0 });
          }
        } catch (err) {
          console.error('[discover-live] campaign AI seed resolve failed:', err);
        }
      } else {
        for (const m of await resolveTopicToSeeds(prompt, { budgetMs: 9_000 })) {
          seeds.push(m.handle);
          autoSeeds.push({ handle: m.handle, followers: m.followers });
        }
      }
      // Still thin → PAID Apify hashtag search as a FALLBACK finds real handles
      // posting under the topic. Only fires when the AI/free seeds came back few,
      // so campaigns lead with AI-named creators rather than hashtag noise. No-op
      // without APIFY_TOKEN.
      if (seeds.length < 8) {
        try {
          const hopts = campaign ? { limit: 20, tags: 2, postsPerTag: 25 } : {};
          for (const m of await resolveHashtagToSeeds(prompt, hopts)) {
            seeds.push(m.handle);
            autoSeeds.push({ handle: m.handle, followers: m.followers });
          }
        } catch (err) {
          console.error('[discover-live] hashtag seed resolve failed:', err);
        }
      }
    }
    const uniqueSeeds = Array.from(new Set(seeds.map((s) => s.trim()).filter(Boolean)));
    if (uniqueSeeds.length === 0) return;
    try {
      // Campaign prompts want a DEEP, well-filled result page (10+ enriched, on-
      // niche creators). The free cookie path is often dead, so seeds enrich via
      // Apify — which is slower per profile. Give campaigns a bigger budget, a
      // higher ceiling, and wide seed concurrency so many profiles hydrate in
      // parallel within that budget. Non-campaign prompts stay lean/cheap.
      // Enrichment gets whatever remains until a 53s wall-clock deadline (leaving
      // ~7s for DB topup + serialization under the 60s ceiling). Because phase 1
      // (hashtag discovery) already consumed part of the window, subtracting the
      // elapsed time is what stops the two Apify phases from together tripping the
      // 504 we hit with a fixed budget. Floored so the batch always gets a usable
      // slice. Normal prompts stay lean and free-path-dominated.
      const campaignBudget = Math.max(24_000, 50_000 - (Date.now() - t0));
      const run = await liveDiscover(prompt, uniqueSeeds, {
        depth,
        max: isCampaign ? Math.max(max, 24) : max,
        budgetMs: isCampaign ? campaignBudget : 15_000,
        seedConcurrency: isCampaign ? 12 : 8,
        // Campaign flow is now: OpenAI names the creators (seeds above) → Apify
        // ENRICHES them with real follower/post data (one batched run). The junk
        // came from the old HASHTAG seed source (#denim → global thrift shops), NOT
        // from Apify — so we keep Apify as the enrichment engine, just pointed at
        // the right, OpenAI-found accounts.
        apifyDirect: isCampaign,
      });
      liveProfiles = run.results.map((r) => ({ ...r, from: 'live' as const }));
    } catch (err) {
      console.error('[discover-live] crawl failed:', err);
    }
  })();

  // HARD CEILING: never let the two pipelines run the function to Vercel's 60s
  // kill (a 504 returns NOTHING and still bills the Apify runs). Cap the wait at
  // 54s — whatever enrichment finished by then is used; anything still in flight
  // is dropped (its seeds were already persisted, so they surface on the next
  // search). This turns a worst-case 504 into a graceful, partial 200.
  await withTimeout(Promise.all([aiPipeline, crawlPipeline]).then(() => null), 46_000, null);

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
        message: handleLookup
          ? `Couldn't fetch @${lookupHandle}. It may be private, mistyped, or Instagram is rate-limiting right now — try again in a moment.`
          : names.length > 0
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
  const merged = flagLocals(Array.from(byUser.values()), tokens);

  // NICHE RELEVANCE GATE. The live crawl expands through Instagram's related-
  // accounts graph, which clusters by region/language — so a "vintage watch
  // collector in mumbai" search pulls in big Mumbai/Marathi news & politics
  // handles that match the LOCATION but have nothing to do with the subject.
  // We flag every result on whether its profile text actually mentions the
  // search's subject words, then keep only the on-topic ones. Curated (the
  // agency's own imported list) is always exempt. Safety net: if the gate would
  // empty the page, we fall back to the ungated set rather than show nothing.
  const nicheGate = handleLookup ? [] : nicheKeywords(prompt);
  for (const p of merged) {
    p.niche_match = hasNicheEvidence(
      `${p.username} ${p.full_name} ${p.biography} ${p.category}`,
      nicheGate,
    );
  }
  // from_ai creators are exempt: OpenAI already web-searched + relevance-verified
  // them for THIS brief, so a keyword gate must not drop a real "Fashion" creator
  // just because their bio doesn't literally contain "denim".
  const relevant =
    nicheGate.length > 0 ? merged.filter((p) => p.niche_match || p.curated || p.from_ai) : merged;
  const gated = relevant.length > 0 ? relevant : merged;

  const results = gated
    // Only DISPLAY creators we actually have data for — no un-enriched stubs
    // (a stub is an AI-suggested handle we couldn't validate live yet: 0
    // followers / unverified). They're still SAVED and enriched in the
    // background; they just don't clutter the results until they have real
    // numbers, then they show up on a later search.
    .filter((p) => {
      if (p.unverified) return false;
      // Direct @handle lookup: always keep the exact account, even if it has a
      // small/zero follower count (e.g. a brand-new or niche personal account).
      if (handleLookup && p.username.toLowerCase() === lookupHandle) return true;
      return p.followers > 0;
    })
    .sort((a, b) => {
      // ① Source priority: OpenAI first, then DB, then live crawl.
      const sr = srcRank(a) - srcRank(b);
      if (sr !== 0) return sr;
      // ② India-first: known-foreign creators (is_indian === false, e.g. old
      // seeded French/Australian craft pages that match a broad token) sink below
      // everYone else. AI/live finds and unflagged rows are treated as Indian.
      const af = a.is_indian === false ? 1 : 0;
      const bf = b.is_indian === false ? 1 : 0;
      if (af !== bf) return af - bf;
      // ③ On-topic first: profiles whose text matches the search's subject lead
      // over off-niche accounts (so the fallback set, and mixed results, still
      // surface relevant creators ahead of location-only matches).
      const an = a.niche_match === false ? 1 : 0;
      const bn = b.niche_match === false ? 1 : 0;
      if (an !== bn) return an - bn;
      // ④ Within a source, genuine locals lead a "…in <place>" query.
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

  // A direct @handle lookup: surface the exact account first, above its network.
  if (handleLookup) {
    const i = results.findIndex((r) => r.username.toLowerCase() === lookupHandle);
    if (i > 0) results.unshift(results.splice(i, 1)[0]!);
  }

  // Tag saved creators with the search's region/niche. When the prompt has no
  // niche (e.g. a bare seed handle), infer it from the crawled network so a
  // search for one fashion creator still tags the whole network as "fashion".
  const cls = classifyPrompt(prompt);
  const niche = cls.niche ?? inferNiche(liveProfiles.length ? liveProfiles : dbMatches);
  const tags = Array.from(new Set([...cls.tags, ...(niche ? [niche] : [])]));
  // Location tokens in this search — used by persist() to gate region/location
  // tagging so only creators actually from the place get stamped with it.
  const placeTokens = cls.tags.filter((t) => isLocationToken(t));
  // Persist EVERY creator surfaced by the search — AI-found (verified AND
  // unverified), plus crawled — so the DB keeps building in the background. The
  // unverified ones (IG was throttled/timed out, so we couldn't confirm them
  // this run) are stored fill-only inside persist(), so their empty fields can
  // never clobber a real existing row; a later search / worker crawl enriches them.
  const persisted = await persist(
    [...aiProfiles, ...liveProfiles],
    { region: cls.region, niche, tags, placeTokens, nicheKeywords: nicheGate },
  );

  // Cache this campaign's canonical key so a re-worded repeat serves the SAME
  // creators from the DB next time instead of re-scraping. Only mark it AFTER we
  // actually surfaced a page for it, so a run that flopped (nothing found) isn't
  // cached — the next attempt is then free to scrape again. Awaited (not fire-
  // and-forget) so the marker is durably written before the serverless function
  // returns and the runtime can freeze.
  if (isCampaign && !searchedBefore && results.length > 0) {
    await markCampaignSearched(prompt);
  }

  // OpenAI-found accounts we couldn't confirm this run (0 followers / unverified
  // stubs) are excluded from `results` — but instead of dropping them from view,
  // return them as `enriching` so the UI can show a "Found — enriching…" section.
  // The account is real and saved; its numbers just fill in later. Only AI finds,
  // deduped against what's already shown, capped so it stays tidy.
  const shownKeys = new Set(results.map((r) => r.username.toLowerCase()));
  const enriching = merged
    .filter((p) => p.from_ai && !shownKeys.has(p.username.toLowerCase()) && !(p.followers > 0 && !p.unverified))
    .slice(0, 15)
    .map((p) => ({
      username: p.username,
      full_name: p.full_name ?? '',
      profile_pic_url: p.profile_pic_url ?? null,
      link: p.link ?? null,
      from_ai: true as const,
      enriching: true as const,
    }));

  const place = extractPlace(prompt, tokens);
  return NextResponse.json({
    prompt,
    tokens,
    results,
    enriching,
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

// Campaign cache markers are stored as inert (status='completed') search_query
// rows whose target_handle is the canonical campaign key behind this prefix — so
// they never collide with real prompt rows and the deep worker (which only picks
// up queued jobs) ignores them.
const CAMPAIGN_CACHE_PREFIX = 'campaign:';

// Campaign counterpart of promptSearchedBefore: has this brief's canonical key
// been searched (and its creators persisted) before? Matches any re-wording of
// the same brief. Fails SAFE (true) on a DB error so a hiccup never triggers a
// re-scrape storm. Empty key (no subject words) → treat as not-searched.
async function campaignSearchedBefore(prompt: string): Promise<boolean> {
  const key = campaignKey(prompt);
  if (!key) return false;
  try {
    const rows = await getBolticClient().query<{ one: number }>(
      `SELECT 1 AS one FROM scrape_jobs
        WHERE job_type = 'search_query'
          AND lower(trim(target_handle)) = $1
        LIMIT 1`,
      [CAMPAIGN_CACHE_PREFIX + key],
    );
    return rows.length > 0;
  } catch {
    return true;
  }
}

// Record that a campaign's canonical key has been searched + persisted, so the
// next re-wording of the same brief is served from the DB. Best-effort.
async function markCampaignSearched(prompt: string): Promise<void> {
  const key = campaignKey(prompt);
  if (!key) return;
  try {
    await getBolticClient().insert('scrape_jobs', {
      job_type: 'search_query',
      target_platform: 'instagram',
      target_handle: CAMPAIGN_CACHE_PREFIX + key,
      priority: 5,
      status: 'completed', // inert marker — the worker only crawls queued jobs
      attempts: 0,
      queued_at: new Date().toISOString(),
    });
  } catch {
    /* best-effort marker */
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
  ctx: { region: string | null; niche: string | null; tags: string[]; placeTokens: string[]; nicheKeywords: string[] },
): Promise<number> {
  if (results.length === 0) return 0;
  const hasTag = Boolean(ctx.region || ctx.niche || ctx.tags.length);
  // Location tokens must NOT be stamped on creators who aren't actually from the
  // place — otherwise a national star matched by niche in a "fashion kolkata"
  // search gets region='kolkata' and pollutes every future kolkata search. We
  // gate region + location-tag writes per creator on real profile-text evidence
  // (same word-boundary test flagLocals uses).
  const wb = (t: string) => new RegExp(`(^|[^a-z])${t}([^a-z]|$)`);
  const isLocal = (p: LiveProfile) => {
    if (ctx.placeTokens.length === 0) return true; // niche-only search: nothing to gate
    if (p.loc_match) return true;
    const text = `${p.username} ${p.full_name} ${p.biography} ${p.category}`.toLowerCase();
    return ctx.placeTokens.some((t) => wb(t).test(text));
  };
  // SYMMETRIC niche gate: don't stamp the search's niche/genre on a creator whose
  // profile shows no evidence of the subject — otherwise an off-topic local
  // (a Mumbai news page swept up by a "vintage watch … mumbai" crawl) gets
  // niche='vintage' and pollutes every future vintage search, exactly the mirror
  // of the location pollution above.
  const isOnNiche = (p: LiveProfile) =>
    p.niche_match ??
    hasNicheEvidence(`${p.username} ${p.full_name} ${p.biography} ${p.category}`, ctx.nicheKeywords);
  let ok = 0;
  try {
    const db = getBolticClient();
    const persistOne = async (p: LiveProfile): Promise<void> => {
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
                profile_photo_url, is_verified, data_completeness, is_indian, source, data_tier, is_active, first_indexed_at)
             VALUES ('instagram', $1, $2, $3, $4, $5, $6, $7, true, 'scrape', 'tier_c', true, NOW())
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
              // This is an India-first platform: the AI suggester is India-only
              // (+ India relevance filter) and the crawl is seeded from Indian
              // creators, so anything surfaced here is an Indian creator. The old
              // deep-scraper set this flag; the discovery path never did, which is
              // why Indian% read artificially low (~34%).
              is_indian: true,
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
            // Stamp region/location only on creators genuinely FROM the place,
            // and niche/genre only on creators actually ON the subject. Strip the
            // corresponding tokens from the tag set otherwise, so neither location
            // nor niche pollutes a creator that only matched the other axis.
            const local = isLocal(p);
            const onNiche = isOnNiche(p);
            const region = local ? ctx.region : null;
            const nicheVal = onNiche ? ctx.niche : null;
            let tags = ctx.tags;
            if (!local) tags = tags.filter((t) => !ctx.placeTokens.includes(t));
            if (!onNiche) tags = tags.filter((t) => !ctx.nicheKeywords.includes(t));
            await db.query(
              `UPDATE creators SET
                 genre  = COALESCE(genre,  $2),
                 niche  = COALESCE(niche,  $3),
                 region = COALESCE(region, $4),
                 tags   = CASE WHEN tags IS NULL OR cardinality(tags) = 0
                               THEN $5::text[] ELSE tags END
               WHERE id = $1`,
              [id, nicheVal, nicheVal, region, tags],
            );
          }
        }
        ok++;
      } catch {
        /* skip a single bad row, keep going */
      }
    };
    // Bounded concurrency: ~24 sequential upserts (each an upsert + a tag UPDATE)
    // added several seconds to the request tail, which — right after a full
    // campaign enrichment — risked tripping the 60s ceiling. A small pool cuts
    // that time without hammering the DB.
    const CONCURRENCY = 6;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < results.length) await persistOne(results[cursor++]!);
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, results.length) }, worker));
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
