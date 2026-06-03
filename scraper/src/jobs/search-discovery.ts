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

const HASHTAGS_TO_EXPLORE_PER_QUERY = 3;
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
          sources: new Set<string>([source]),
        });
      };

      try {
        // 1. Topsearch — users + hashtags
        const ts = await fetch(`/web/search/topsearch/?query=${encodeURIComponent(q)}`, {
          headers,
          credentials: 'include',
        });
        if (!ts.ok) return { error: `topsearch HTTP ${ts.status}` };
        const tj = await ts.json();

        for (const e of (tj?.users ?? []) as Array<{ user: any }>) {
          if (e?.user?.username) addCandidate(e.user, 'topsearch_user');
        }

        // 2. Hashtag exploration — IG topsearch sometimes returns a hashtags
        // array, sometimes not. Build candidate tags from BOTH:
        //   (a) topsearch.hashtags (when present)
        //   (b) query-word permutations (e.g. "mumbai skincare" → mumbaiskincare,
        //       skincaremumbai, mumbaibeauty)
        const tsHashtags = (tj?.hashtags ?? []) as Array<{ hashtag?: { name?: string } }>;
        const fromTopsearch = tsHashtags
          .map((h) => h?.hashtag?.name)
          .filter((n): n is string => typeof n === 'string');

        const cleanWords = q
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
          .filter((w) => w.length >= 3 && w !== 'india' && w !== 'indian');
        const fromQuery: string[] = [];
        if (cleanWords.length > 0) {
          fromQuery.push(cleanWords.join(''));               // "mumbaiskincare"
          fromQuery.push(`${cleanWords.join('')}india`);     // "mumbaiskincareindia"
          if (cleanWords.length >= 2) {
            fromQuery.push([...cleanWords].reverse().join('')); // "skincaremumbai"
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

        // 4. Enrich follower counts for candidates that don't have them.
        // Cap to 40 enrichment lookups (chaining brought in many candidates).
        const list = Array.from(candidatesByHandle.values());
        const needsEnrich = list.filter((c) => c.follower_count == null).slice(0, 40);
        for (let i = 0; i < needsEnrich.length; i += 5) {
          const batch = needsEnrich.slice(i, i + 5);
          await Promise.all(
            batch.map(async (c) => {
              try {
                const pr = await fetch(
                  `/api/v1/users/web_profile_info/?username=${encodeURIComponent(c.username)}`,
                  { headers, credentials: 'include' },
                );
                if (!pr.ok) return;
                const pj = await pr.json();
                const count = pj?.data?.user?.edge_followed_by?.count;
                if (typeof count === 'number') c.follower_count = count;
                if (!c.profile_pic_url && pj?.data?.user?.profile_pic_url) {
                  c.profile_pic_url = pj.data.user.profile_pic_url;
                }
                if (!c.full_name && pj?.data?.user?.full_name) {
                  c.full_name = pj.data.user.full_name;
                }
                if (typeof pj?.data?.user?.is_verified === 'boolean' && !c.is_verified) {
                  c.is_verified = pj.data.user.is_verified;
                }
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
    sources: string[];
  }>;
  console.log(
    `[search] "${query}": ${candidates.length} unique candidates (${harvest?.tagsExplored ?? 0} hashtags explored)`,
  );

  // Quality filter: drop candidates with KNOWN sub-5K follower counts (the
  // chaining + followings expansion brings in lots of nano accounts that
  // would just waste deep-scrape time only to be deactivated by the quality
  // gate). Keep candidates with unknown counts — let profile-scraper decide.
  const qualified = candidates.filter((c) => {
    if (typeof c.follower_count === 'number' && c.follower_count < 5_000) return false;
    return true;
  });
  const droppedCount = candidates.length - qualified.length;
  if (droppedCount > 0) {
    console.log(`[search] "${query}": dropped ${droppedCount} sub-5K candidates upfront`);
  }

  // Multi-source candidates rank higher: surfaced by both topsearch + hashtag
  // → strong signal. Sort by source count desc, then follower_count desc.
  qualified.sort((a, b) => {
    const sa = a.sources.length;
    const sb = b.sources.length;
    if (sa !== sb) return sb - sa;
    const fa = a.follower_count ?? 0;
    const fb = b.follower_count ?? 0;
    return fb - fa;
  });

  const db = getBolticClient();
  const llm = getOpenAIClient();
  let added = 0;
  // Cap deep-scrape queueing per query — multi-source expansion now yields
  // hundreds of candidates per query. Take the top 30 by source-count +
  // follower count (already sorted by qualified.sort below).
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

    // Queue deep scrape (priority 2 — behind brand-driven on_demand at 1).
    await queue.enqueueBackground({
      job_type: 'on_demand',
      target_handle: handle,
      brief_id: job.brief_id ?? undefined,
      priority: 2,
    });
  }

  console.log(
    `[search] "${query}": ${added} qualified candidates upserted (multi-source first), deep scrapes queued`,
  );
  await humanDelay();
}
