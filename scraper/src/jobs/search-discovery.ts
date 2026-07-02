// ============================================================
// IG search discovery — multi-source candidate harvester.
//
// For one query we now extract creators from THREE sources inside one
// authenticated session:
//   1. topsearch users → directly ranked by IG for the query
//   2. topsearch hashtags → for each top hashtag, fetch its top media
//      and harvest the post authors (often where real creators live)
//   3. similar-account chaining (off, planned for high-confidence seeds)
//
// Each candidate gets a real follower_count via web_profile_info and is
// upserted as a stub. Multi-source candidates are tracked and prioritised
// (a handle surfaced by multiple queries / sources is a stronger signal).
// ============================================================

import type { ScrapeJob } from '@influencer-intel/shared/types';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import { humanDelay, navigateHumanly, type DriverHandle } from '../playwright-driver.js';
import type { JobQueue } from '../queue/worker.js';

interface IgUser {
  pk?: string | number;
  username: string;
  full_name?: string;
  is_verified?: boolean;
  is_private?: boolean;
  follower_count?: number;
  profile_pic_url?: string;
}

interface DiscoveryCandidate {
  username: string;
  full_name?: string;
  profile_pic_url?: string | null;
  is_verified?: boolean;
  follower_count?: number | null;
  source: 'topsearch_user' | 'hashtag_top_media';
}

const HASHTAGS_TO_EXPLORE_PER_QUERY = 5;
const SEEDS_TO_EXPAND_PER_QUERY = 3;          // top N strong seeds to chain from
const SEED_MIN_FOLLOWERS = 10_000;            // chain from any real creator (tier-2 cities have smaller seeds)
const CHAIN_LIMIT_PER_SEED = 40;              // candidates per chaining call
const FOLLOWINGS_LIMIT_PER_SEED = 60;         // sample of seed's followings

export async function handleSearchQuery(
  job: ScrapeJob,
  driver: DriverHandle,
  queue: JobQueue,
): Promise<void> {
  const query = job.target_handle.trim();
  console.log(`[search] querying IG for "${query}"`);

  if (!driver.page.url().startsWith('https://www.instagram.com/')) {
    await navigateHumanly(driver.page, 'https://www.instagram.com/');
  }
  queue.bumpActions(1);

  // ALL discovery happens inside a single page.evaluate so we share the
  // authenticated fetch context. We collect candidates from topsearch + the
  // top hashtags surfaced for the query, then enrich each with real
  // follower counts via web_profile_info.
  const harvest = await driver.page.evaluate(
    async ({
      q,
      hashtagsToExplore,
      seedsToExpand,
      seedMinFollowers,
      chainLimitPerSeed,
      followingsLimitPerSeed,
    }: {
      q: string;
      hashtagsToExplore: number;
      seedsToExpand: number;
      seedMinFollowers: number;
      chainLimitPerSeed: number;
      followingsLimitPerSeed: number;
    }) => {
      // tsx (the TypeScript runner) injects `__name(fn, "displayName")` calls
      // around every named binding for source-map metadata. The browser
      // context doesn't have `__name`, so the bundled page-evaluate body
      // throws TypeError on first call. Polyfill it as identity here.
      const g: any = globalThis;
      if (typeof g.__name !== 'function') g.__name = (fn: unknown) => fn;

      const headers = {
        'X-Requested-With': 'XMLHttpRequest',
        'X-IG-App-ID': '936619743392459',
      };

      const candidatesByHandle = new Map<string, DiscoveryCandidateRaw>();
      // Arrow expression (no named declaration) — tsx injects __name(fn, "name")
      // for named function decls, which doesn't exist in the browser context.
      const addCandidate = (u: any, source: string) => {
        if (!u?.username) return;
        const handle = String(u.username).toLowerCase();
        const existing = candidatesByHandle.get(handle);
        if (existing) {
          existing.sources.add(source);
          if (existing.follower_count == null && typeof u.follower_count === 'number') {
            existing.follower_count = u.follower_count;
          }
          if (!existing.full_name && u.full_name) existing.full_name = u.full_name;
          return;
        }
        candidatesByHandle.set(handle, {
          username: handle,
          full_name: u.full_name ?? null,
          profile_pic_url: u.profile_pic_url ?? null,
          is_verified: !!u.is_verified,
          follower_count: typeof u.follower_count === 'number' ? u.follower_count : null,
          biography: null,
          category: null,
          sources: new Set<string>([source]),
        });
      };

      // Pull the MEANINGFUL keywords out of a natural-language prompt
      // ("fashion creator in pune" → ["fashion","pune"]) so topsearch and the
      // hashtag harvest hit real niche/location terms instead of the literal
      // sentence (which returns generic mega-accounts like @instagram).
      const STOP = new Set([
        'creator', 'creators', 'influencer', 'influencers', 'content', 'page', 'pages',
        'account', 'accounts', 'profile', 'profiles', 'top', 'best', 'find', 'looking',
        'based', 'from', 'near', 'around', 'the', 'and', 'for', 'with', 'who', 'that',
        'india', 'indian', 'instagram', 'insta', 'reels', 'reel',
      ]);
      const words = q
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w));
      const qClean = words.length > 0 ? words.join(' ') : q;

      try {
        // 1. Topsearch — users + hashtags, on the cleaned keywords.
        const ts = await fetch(`/web/search/topsearch/?query=${encodeURIComponent(qClean)}`, {
          headers,
          credentials: 'include',
        });
        if (!ts.ok) return { error: `topsearch HTTP ${ts.status}` };
        const tj = await ts.json();

        for (const e of (tj?.users ?? []) as Array<{ user: any }>) {
          if (e?.user?.username) addCandidate(e.user, 'topsearch_user');
        }

        // 2. Hashtag exploration. Build REAL candidate tags from:
        //   (a) topsearch.hashtags (when present)
        //   (b) each keyword on its own (#pune, #fashion)
        //   (c) pairwise concatenations, both orders (#punefashion, #fashionpune)
        const tsHashtags = (tj?.hashtags ?? []) as Array<{ hashtag?: { name?: string } }>;
        const fromTopsearch = tsHashtags
          .map((h) => h?.hashtag?.name)
          .filter((n): n is string => typeof n === 'string');

        const fromQuery: string[] = [];
        for (const w of words) fromQuery.push(w);
        for (let i = 0; i < words.length; i++) {
          for (let j = 0; j < words.length; j++) {
            if (i !== j) fromQuery.push(words[i]! + words[j]!);
          }
        }

        const tagsToExplore = Array.from(new Set([...fromTopsearch, ...fromQuery]))
          .slice(0, hashtagsToExplore);

        for (const tag of tagsToExplore) {
          try {
            const tr = await fetch(`/api/v1/tags/web_info/?tag_name=${encodeURIComponent(tag)}`, {
              headers,
              credentials: 'include',
            });
            if (!tr.ok) continue;
            const tj2 = await tr.json();
            // Both top + recent media; we want top because IG ranks them.
            const sections = [
              ...(tj2?.data?.top?.sections ?? []),
              ...(tj2?.data?.recent?.sections ?? []),
            ];
            for (const sec of sections) {
              const items = sec?.layout_content?.medias ?? sec?.media ?? [];
              for (const m of items) {
                const owner = m?.media?.user ?? m?.user ?? null;
                if (owner?.username) addCandidate(owner, 'hashtag_top_media');
              }
            }
            await new Promise((res) => setTimeout(res, 400 + Math.random() * 500));
          } catch {}
        }

        // 3. Pick high-signal seeds from topsearch users (verified or
        //    sufficiently followed) and EXPAND each via:
        //      a) IG's "similar accounts" chaining recommendation
        //      b) the seed's own followings (creators tend to follow other
        //         creators in their niche)
        //    This is the biggest single multiplier on candidate yield —
        //    a 5-result topsearch becomes 200-400 candidates.
        const seedCandidates = (tj?.users ?? []) as Array<{ user: any }>;
        const enrichedSeeds: any[] = [];
        for (const e of seedCandidates.slice(0, 6)) {
          const u = e.user;
          if (!u?.username) continue;
          // Resolve user id + follower count via web_profile_info
          try {
            const pr = await fetch(
              `/api/v1/users/web_profile_info/?username=${encodeURIComponent(u.username)}`,
              { headers, credentials: 'include' },
            );
            if (!pr.ok) continue;
            const pj = await pr.json();
            const userInfo = pj?.data?.user;
            if (!userInfo?.id) continue;
            const fc = userInfo.edge_followed_by?.count;
            const verified = !!userInfo.is_verified;
            // Update the seed candidate with real counts
            const handle = String(u.username).toLowerCase();
            const existing = candidatesByHandle.get(handle);
            if (existing) {
              if (typeof fc === 'number') existing.follower_count = fc;
              existing.is_verified = existing.is_verified || verified;
            }
            // Only chain from STRONG seeds — verified or ≥ seedMinFollowers
            if (verified || (typeof fc === 'number' && fc >= seedMinFollowers)) {
              enrichedSeeds.push({ id: String(userInfo.id), username: u.username, fc, verified });
            }
          } catch {}
          await new Promise((res) => setTimeout(res, 200 + Math.random() * 250));
          if (enrichedSeeds.length >= seedsToExpand) break;
        }

        for (const seed of enrichedSeeds.slice(0, seedsToExpand)) {
          // 3a. Similar-accounts chaining — IG's own recommendation graph
          try {
            const cr = await fetch(
              `/api/v1/discover/chaining/?target_id=${encodeURIComponent(seed.id)}`,
              { headers, credentials: 'include' },
            );
            if (cr.ok) {
              const cj = await cr.json();
              const users = (cj?.users ?? []) as any[];
              for (const u of users.slice(0, chainLimitPerSeed)) {
                if (u?.username) addCandidate(u, `chain:${seed.username}`);
              }
            }
          } catch {}
          await new Promise((res) => setTimeout(res, 400 + Math.random() * 400));

          // 3b. Followings mining — who does this seed follow?
          try {
            const fr = await fetch(
              `/api/v1/friendships/${encodeURIComponent(seed.id)}/following/?count=${followingsLimitPerSeed}`,
              { headers, credentials: 'include' },
            );
            if (fr.ok) {
              const fj = await fr.json();
              const users = (fj?.users ?? []) as any[];
              for (const u of users.slice(0, followingsLimitPerSeed)) {
                if (u?.username) addCandidate(u, `follows:${seed.username}`);
              }
            }
          } catch {}
          await new Promise((res) => setTimeout(res, 400 + Math.random() * 400));
        }

        // 4. Enrich the TOP candidates with real follower_count AND bio/category.
        // Node uses the bio/category to gate on genuine relevance to the query
        // (so a crawl that drifts into an unrelated cluster doesn't save junk).
        // Multi-source / higher-reach candidates first; capped so one search
        // doesn't fire so many web_profile_info calls that the account 429s.
        const list = Array.from(candidatesByHandle.values());
        list.sort((a, b) => (b.sources.size - a.sources.size) || ((b.follower_count ?? 0) - (a.follower_count ?? 0)));
        const toEnrich = list.slice(0, 30);
        for (let i = 0; i < toEnrich.length; i += 5) {
          const batch = toEnrich.slice(i, i + 5);
          await Promise.all(
            batch.map(async (c) => {
              try {
                const pr = await fetch(
                  `/api/v1/users/web_profile_info/?username=${encodeURIComponent(c.username)}`,
                  { headers, credentials: 'include' },
                );
                if (!pr.ok) return;
                const pj = await pr.json();
                const u = pj?.data?.user;
                if (!u) return;
                const count = u.edge_followed_by?.count;
                if (typeof count === 'number') c.follower_count = count;
                if (!c.profile_pic_url && u.profile_pic_url) c.profile_pic_url = u.profile_pic_url;
                if (!c.full_name && u.full_name) c.full_name = u.full_name;
                if (typeof u.is_verified === 'boolean' && !c.is_verified) c.is_verified = u.is_verified;
                if (typeof u.biography === 'string') c.biography = u.biography;
                if (typeof u.category_name === 'string') c.category = u.category_name;
              } catch {}
            }),
          );
          await new Promise((res) => setTimeout(res, 400 + Math.random() * 600));
        }

        // Convert sources Set to array for JSON serialisation
        return {
          candidates: list.map((c) => ({
            username: c.username,
            full_name: c.full_name ?? null,
            profile_pic_url: c.profile_pic_url ?? null,
            is_verified: !!c.is_verified,
            follower_count: c.follower_count ?? null,
            biography: c.biography ?? null,
            category: c.category ?? null,
            sources: Array.from(c.sources),
          })),
          tagsExplored: tagsToExplore.length,
        };
      } catch (err) {
        return { error: String(err) };
      }

      // ----- types local to page.evaluate -----
      type DiscoveryCandidateRaw = {
        username: string;
        full_name: string | null;
        profile_pic_url: string | null;
        is_verified: boolean;
        follower_count: number | null;
        biography: string | null;
        category: string | null;
        sources: Set<string>;
      };
    },
    {
      q: query,
      hashtagsToExplore: HASHTAGS_TO_EXPLORE_PER_QUERY,
      seedsToExpand: SEEDS_TO_EXPAND_PER_QUERY,
      seedMinFollowers: SEED_MIN_FOLLOWERS,
      chainLimitPerSeed: CHAIN_LIMIT_PER_SEED,
      followingsLimitPerSeed: FOLLOWINGS_LIMIT_PER_SEED,
    },
  );

  if (harvest?.error) {
    console.warn(`[search] "${query}" failed: ${harvest.error}`);
    return;
  }

  const candidates = (harvest?.candidates ?? []) as Array<{
    username: string;
    full_name: string | null;
    profile_pic_url: string | null;
    is_verified: boolean;
    follower_count: number | null;
    biography: string | null;
    category: string | null;
    sources: string[];
  }>;
  console.log(
    `[search] "${query}": ${candidates.length} unique candidates (${harvest?.tagsExplored ?? 0} hashtags explored)`,
  );

  // Keywords from the prompt (same cleaning as the in-page harvest) so we can
  // score how relevant each candidate's handle/name is to what was searched.
  const STOP = new Set([
    'creator', 'creators', 'influencer', 'influencers', 'content', 'page', 'pages',
    'account', 'accounts', 'profile', 'profiles', 'top', 'best', 'find', 'looking',
    'based', 'from', 'near', 'around', 'the', 'and', 'for', 'with', 'who', 'that',
    'india', 'indian', 'instagram', 'insta', 'reels', 'reel',
  ]);
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));

  // News / TV / magazine / agency accounts blanket every hashtag and dominate by
  // reach — they're never the niche creator you searched for. Hard-drop them.
  const BLOCK_RE =
    /(news|tvnews|\btv\b|times|jagran|dainik|bhaskar|aajtak|abplive|samachar|patrika|reporter|magazine|\bmedia\b|\bpress\b|gazette|tribune|herald|headlines|breaking|bulletin|newspaper|\bnews\d)/i;

  // Shops / wholesalers / brands / events post heavily on hashtags to sell, so
  // they flood the harvest — but they're businesses, not creators. Hard-drop the
  // obvious commerce/brand/event accounts by name.
  const SHOP_RE =
    /(wholesale|whole_sale|\bstore\b|\bshop\b|\bshops\b|shopping|boutique|\bmart\b|collections?|couture|\bbuy\b|\bsale\b|\bsales\b|\bdeals?\b|\boffers?\b|export|exports|manufactur|supplier|wholesaler|retail|\btrader\b|emporium|bazaar|\bmall\b|clothing|garments?|textiles?|fabrics?|sarees?|kurtis?|lehenga|fashionweek|fashion_week|outlet|enterprises?|\bpvt\b|\bltd\b|\binc\b|industries|\bco\b|\bhub\b|\bworld\b|\bbazar\b|jewellery|jewelry|footwear)/i;

  // Everything we know about a candidate's OWN profile, for relevance checks.
  const profileText = (c: { username: string; full_name: string | null; biography: string | null; category: string | null }) =>
    `${c.username} ${c.full_name ?? ''} ${c.biography ?? ''} ${c.category ?? ''}`.toLowerCase();

  const qualified = candidates.filter((c) => {
    // Drop KNOWN sub-5K (nano) — keep unknowns, let the profile-scraper decide.
    if (typeof c.follower_count === 'number' && c.follower_count < 5_000) return false;
    // Drop mega accounts (>3M) — for a niche/local search these are brands,
    // celebs or news outlets, not the creator you want.
    if (typeof c.follower_count === 'number' && c.follower_count > 3_000_000) return false;
    const id = `${c.username} ${c.full_name ?? ''}`.toLowerCase();
    if (BLOCK_RE.test(id)) return false;
    if (SHOP_RE.test(id)) return false;
    // RELEVANCE GATE: keep only creators whose own profile (handle/name/bio/
    // category) actually supports the query. Without this, a crawl that drifts
    // into an unrelated cluster (e.g. South-film stars surfaced for a "kolkata"
    // search) gets saved and tagged with the query — poisoning DB search. A
    // creator is relevant if ANY query keyword appears in their profile text.
    if (keywords.length > 0 && !keywords.some((k) => profileText(c).includes(k))) return false;
    return true;
  });
  const droppedCount = candidates.length - qualified.length;
  if (droppedCount > 0) {
    console.log(`[search] "${query}": dropped ${droppedCount} off-target candidates (nano / mega / news / shops)`);
  }

  // Relevance score: a prompt keyword in the handle/name is the strongest signal
  // (a real "pune fashion" creator usually says so), then multi-source surfacing,
  // then a mid-tier follower sweet spot (10K-500K) — so shortlist-grade creators
  // beat both nano noise and mega generic accounts. Raw reach is only a tiebreak.
  const relScore = (c: { username: string; full_name: string | null; biography: string | null; category: string | null; follower_count: number | null; sources: string[] }): number => {
    const id = profileText(c);
    let s = 0;
    for (const k of keywords) if (id.includes(k)) s += 3;
    s += Math.min(c.sources.length, 4);
    // Favour bigger creators (within the <3M cap) so higher-reach names rank up.
    const f = c.follower_count ?? 0;
    if (f > 1_000_000) s += 4;
    else if (f > 500_000) s += 3;
    else if (f > 100_000) s += 2.5;
    else if (f > 50_000) s += 2;
    else if (f > 10_000) s += 1;
    return s;
  };
  qualified.sort((a, b) => {
    const ra = relScore(a);
    const rb = relScore(b);
    if (ra !== rb) return rb - ra;
    return (b.follower_count ?? 0) - (a.follower_count ?? 0);
  });

  const db = getBolticClient();
  const llm = getOpenAIClient();
  let added = 0;
  // Cap deep-scrape queueing per query. Each upserted creator gets an on_demand
  // deep scrape queued below, which fills real followers / posts / engagement /
  // recent reels (the reel forecast) at a human pace — we deliberately do NOT
  // burst-fetch profiles inline here, which just gets the account rate-limited
  // (429) and starves those deep scrapes of data.
  const CAP_PER_QUERY = 30;

  for (const c of qualified.slice(0, CAP_PER_QUERY)) {
    const handle = c.username;
    if (!/^[a-z0-9._]+$/i.test(handle)) continue;

    // Light embedding: mixes the query (intent) with the candidate's name
    // so future briefs can semantically match these creators immediately.
    const embedText = `${c.full_name ?? ''} ${handle} ${query}`.trim();
    let embedding: number[] | null = null;
    try {
      embedding = await llm.embed(embedText);
    } catch {}

    await db.upsert(
      'creators',
      {
        platform: 'instagram',
        handle,
        profile_url: `https://www.instagram.com/${handle}/`,
        display_name: c.full_name ?? null,
        profile_photo_url: c.profile_pic_url ?? null,
        is_verified: c.is_verified ?? false,
        follower_count: c.follower_count ?? null,
        data_tier: 'tier_c',
        is_active: true,
        ...(embedding ? { content_embedding: embedding } : {}),
        first_indexed_at: new Date().toISOString(),
      },
      ['platform', 'handle'],
    );
    added++;

    // Tag the creator with (a) the originating search job so the platform can
    // poll "the creators this search produced", and (b) ONLY the search keywords
    // its own profile actually supports — so we never stamp "kolkata" on a
    // creator whose bio/name/category never mentions it. Blindly tagging every
    // keyword is what poisoned DB search (foreign accounts tagged "kolkata").
    // Append-only, deduped.
    const matchedKeywords = keywords.filter((k) => profileText(c).includes(k));
    try {
      await db.query(
        `UPDATE creators
           SET tags = (SELECT array_agg(DISTINCT t)
                       FROM unnest(coalesce(tags, '{}'::text[]) || $1::text[]) AS t)
         WHERE platform = 'instagram' AND handle = $2`,
        [[`search:${job.id}`, ...matchedKeywords], handle],
      );
    } catch {
      /* tagging is best-effort; don't fail the whole search on one row */
    }

    // NOTE: discovery is now discovery-ONLY. We deliberately do NOT queue a deep
    // scrape per creator — that used to enqueue ~30 on_demand jobs per search,
    // clogging the worker and hammering the account for creators nobody views.
    // Rich data (posts / ER / reels) is now fetched on demand by the cookie
    // scraper when a creator is actually opened in the drawer.
  }

  console.log(
    `[search] "${query}": ${added} qualified candidates upserted (discovery-only, no deep scrapes)`,
  );
  await humanDelay();
}
