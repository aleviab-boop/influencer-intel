// ============================================================
// Profile-scrape handler.
// Navigates to instagram.com/{handle}, lets the extension extract
// 50+ fields, persists to creators row + folded JSONB columns.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type {
  AudienceDemographics,
  Creator,
  CreatorRawMetadata,
  ExtensionExtractionResult,
  RecentPost,
  ScrapeJob,
} from '@influencer-intel/shared/types';
import { humanDelay, navigateHumanly, type DriverHandle } from '../playwright-driver.js';
import type { JobQueue } from '../queue/worker.js';
import { computeCredibilityFromExtraction } from './credibility-scorer.js';
import { extractProfileInPage } from '../ig-extract.js';

export async function handleProfileScrape(
  job: ScrapeJob,
  driver: DriverHandle,
  queue: JobQueue,
): Promise<void> {
  const handle = job.target_handle.toLowerCase().replace(/^@/, '');
  const url = `https://www.instagram.com/${handle}/`;

  const ok = await navigateHumanly(driver.page, url);
  if (!ok) throw new Error(`Failed to navigate to ${url}`);
  queue.bumpActions(1);

  // Run the IG extractor inside the page (replaces our old Chrome extension).
  const extraction = await extractProfileInPage(driver.page, handle);
  console.log(
    `[profile-scraper] ${handle}: ${extraction.follower_count ?? 'N/A'} followers, ` +
    `${extraction.posts_count ?? 'N/A'} posts, tier=${extraction.tier ?? 'N/A'}`,
  );

  // Quality gate — under-5K accounts are not shortlist-worthy. Persist a thin
  // row marked inactive so we don't keep re-scraping them, and skip vision
  // (saves OpenAI tokens) + audience_inference (saves scraper time).
  const tooSmall =
    typeof extraction.follower_count === 'number' && extraction.follower_count < 5_000;

  // Fast-path nano: persist thin row, no vision/geo/embed/audience inference.
  // Saves ~25-40s per nano (was ~30% of all jobs).
  if (tooSmall) {
    console.log(`[profile-scraper] ${handle}: skipping enrichment (only ${extraction.follower_count} followers)`);
    await persistCreatorThin(extraction);
    await fastDelay();
    return;
  }

  // Run vision and post-signals IN PARALLEL — they're independent network
  // calls and previously ran sequentially (~10-15s each = 20-30s).
  const llm = getOpenAIClient();
  const visionPromise = (async () => {
    try {
      const screenshot = await driver.page.screenshot({ fullPage: false, type: 'png' });
      const b64 = Buffer.from(screenshot).toString('base64');
      const v = await llm.extractFromProfileScreenshot(b64);
      const fieldCount = Object.keys(v ?? {}).length;
      if (fieldCount >= 5) return v as import('@influencer-intel/shared/types').VisionEnrichment;
      console.warn(`[profile-scraper] ${handle}: vision only ${fieldCount} fields, dropping`);
      return null;
    } catch (err) {
      console.warn(`[profile-scraper] ${handle}: vision failed`, (err as Error).message);
      return null;
    }
  })();
  const geoPromise = (async () => {
    try {
      return await fetchGeoSignals(driver, handle, extraction.follower_count ?? null);
    } catch (err) {
      console.warn(`[profile-scraper] ${handle}: geo failed`, (err as Error).message);
      return null;
    }
  })();
  const [vision, geoSignals] = await Promise.all([visionPromise, geoPromise]);

  if (vision) console.log(`[profile-scraper] ${handle}: vision extracted ${Object.keys(vision).length} fields`);
  if (geoSignals) {
    console.log(
      `[profile-scraper] ${handle}: ER=${geoSignals.engagement_rate ?? '—'}% ` +
      `· ${geoSignals.posts_per_week ?? '—'} posts/wk ` +
      `· geo ${geoSignals.posts_with_location}/${geoSignals.posts_sampled}` +
      (geoSignals.top_cities[0] ? ` (${geoSignals.top_cities[0].name})` : ''),
    );
  }

  await persistCreator(extraction, vision, { isActive: true, geoSignals });

  // Fire-and-forget audience inference enqueue (don't block this job).
  void queue.enqueueBackground({
    job_type: 'audience_inference',
    target_handle: handle,
    priority: 7,
  });

  await fastDelay();
}

/** Tight delay between scrape jobs — 0.5-2s instead of the original 3-15s. */
function fastDelay(): Promise<void> {
  const ms = 500 + Math.random() * 1_500;
  return new Promise((r) => setTimeout(r, ms));
}

/** Thin persist for sub-5K creators — minimal embedding, no vision/geo. */
async function persistCreatorThin(extraction: ExtensionExtractionResult): Promise<void> {
  const db = getBolticClient();
  const row: Partial<Creator> = {
    platform: 'instagram',
    handle: extraction.handle,
    profile_url: `https://www.instagram.com/${extraction.handle}/`,
    display_name: extraction.display_name,
    bio: extraction.bio,
    profile_photo_url: extraction.profile_photo_url,
    is_verified: extraction.is_verified,
    follower_count: extraction.follower_count,
    following_count: extraction.following_count,
    posts_count: extraction.posts_count,
    is_active: false, // sub-5K — won't appear in shortlists
    is_indian: extraction.is_indian_inferred ?? null,
    last_scraped_at: extraction.extracted_at,
  };
  await db.upsert<Creator>('creators', row as Record<string, unknown>, ['platform', 'handle']);
}

async function persistCreator(
  extraction: ExtensionExtractionResult,
  vision: import('@influencer-intel/shared/types').VisionEnrichment | null = null,
  opts: { isActive?: boolean; geoSignals?: GeoSignals | null } = {},
): Promise<Creator> {
  const isActive = opts.isActive ?? true;
  const geoSignals = opts.geoSignals ?? null;
  const db = getBolticClient();
  const llm = getOpenAIClient();

  // Embedding text — semantic-rich; expand short fields into prose so
  // text-embedding-3-small captures vibe/niche/region/language properly.
  // Vector search uses this to match briefs.
  const langName = (() => {
    const c = extraction.language_inferred;
    if (!c) return '';
    return ({ hi: 'hindi', mr: 'marathi', ta: 'tamil', te: 'telugu', bn: 'bengali', gu: 'gujarati', kn: 'kannada', pa: 'punjabi', ml: 'malayalam', or: 'odia', en: 'english' } as Record<string, string>)[c] ?? c;
  })();
  const visionN = (vision?.niche as string | undefined) ?? '';
  const visionThemes = ((vision?.content_themes as string[] | undefined) ?? []).join(', ');
  const visionVibe = ((vision?.vibe_tags as string[] | undefined) ?? []).join(', ');
  const visionSubNiches = ((vision?.sub_niches as string[] | undefined) ?? []).join(', ');
  const tierLabel = extraction.tier ? `${extraction.tier} tier creator` : '';
  const cityName = geoSignals?.top_cities?.[0]?.name ?? '';

  const embeddingText = [
    extraction.display_name ?? '',
    extraction.bio ?? '',
    extraction.category ?? '',
    visionN,
    visionSubNiches,
    visionThemes && `themes: ${visionThemes}`,
    visionVibe && `vibe: ${visionVibe}`,
    tierLabel,
    extraction.is_indian_inferred ? 'India' : '',
    langName && `${langName} content`,
    cityName && `based in ${cityName}`,
  ].filter(Boolean).join(' | ');
  const embedding = await llm.embed(embeddingText);

  const credibility = computeCredibilityFromExtraction(extraction, vision, {
    engagement_rate: geoSignals?.engagement_rate ?? null,
    posts_per_week: geoSignals?.posts_per_week ?? null,
    last_post_at: geoSignals?.last_post_at ?? null,
  });

  // Estimate engagement rate roughly: assume 2% baseline for now
  // (real ER needs post-level like/comment counts which we'll add later).
  // Engagement rate from per-post averages (when feed call succeeded)
  const engagementRate = geoSignals?.engagement_rate != null
    ? geoSignals.engagement_rate / 100  // store as fraction, UI formats as %
    : null;

  const recent_posts: RecentPost[] = extraction.recent_posts;

  const audience_demographics: AudienceDemographics = {
    source: 'inferred_scraping',
    sample_size: 0,
    confidence: 'low',
    gender: { male_pct: null, female_pct: null, other_pct: null },
    age_bands: { '18_24': null, '25_34': null, '35_44': null, '45_64': null },
    top_cities: [],
    country_india_pct: extraction.is_indian_inferred ? 80 : null,
    top_languages: extraction.language_inferred ? [{ lang: extraction.language_inferred, pct: 100 }] : [],
    computed_at: new Date().toISOString(),
  };

  const raw_metadata: CreatorRawMetadata & { geo?: unknown } = {
    external_link: extraction.external_link ?? null,
    category: extraction.category ?? null,
    account_type: extraction.account_type ?? null,
    tier: extraction.tier ?? null,
    follower_to_following_ratio: extraction.follower_to_following_ratio ?? null,
    highlights_count: extraction.highlights_count ?? null,
    reel_count_in_grid: extraction.reel_count_in_grid ?? null,
    post_count_in_grid: extraction.post_count_in_grid ?? null,
    is_indian_inferred: extraction.is_indian_inferred ?? false,
    language_inferred: extraction.language_inferred ?? null,
    og: extraction.og ?? { title: null, description: null, image: null, url: null },
    page_url: extraction.page_url ?? `https://www.instagram.com/${extraction.handle}/`,
    extracted_at: extraction.extracted_at,
    ...(vision ? { vision, vision_extracted_at: new Date().toISOString() } : {}),
    ...(geoSignals ? { geo: geoSignals } : {}),
  };

  // Operating region: pick the top geo-tagged city if confidence is reasonable.
  const operatingCity =
    geoSignals && geoSignals.posts_with_location >= 3
      ? geoSignals.top_cities[0]?.name ?? null
      : null;

  // Override bio if vision found a richer one and DOM didn't
  const bioMerged = extraction.bio ?? vision?.bio_text ?? null;
  // Use vision's niche if extension didn't find a category
  const categoryMerged = extraction.category ?? vision?.niche ?? null;

  const dataTier = (extraction.tier === 'mega' || extraction.tier === 'macro') ? 'tier_b' : 'tier_c';

  const row: Partial<Creator> = {
    platform: 'instagram',
    handle: extraction.handle,
    profile_url: `https://www.instagram.com/${extraction.handle}/`,
    display_name: extraction.display_name,
    bio: bioMerged,
    profile_photo_url: extraction.profile_photo_url,
    is_verified: extraction.is_verified,
    follower_count: extraction.follower_count,
    following_count: extraction.following_count,
    posts_count: extraction.posts_count,
    engagement_rate: engagementRate,
    avg_likes: geoSignals?.avg_likes ?? null,
    avg_comments: geoSignals?.avg_comments ?? null,
    avg_views: geoSignals?.avg_views ?? null,
    primary_category: categoryMerged,
    primary_city: operatingCity,
    content_languages: extraction.language_inferred ? [extraction.language_inferred] : null,
    is_active: isActive,
    is_indian: extraction.is_indian_inferred ?? null,
    data_tier: dataTier,
    recent_posts,
    audience_demographics,
    credibility,
    raw_metadata,
    content_embedding: embedding,
    last_scraped_at: extraction.extracted_at,
    last_full_refresh: extraction.extracted_at,
  };

  return db.upsert<Creator>('creators', row as Record<string, unknown>, ['platform', 'handle']);
}

// ============================================================
// Post-level signal harvest — one IG feed fetch yields engagement,
// captions, hashtags, posting frequency, last-post date, location
// tags. We were only using location; now we capture everything.
// ============================================================

interface GeoSignals {
  posts_sampled: number;
  posts_with_location: number;
  top_cities: Array<{ name: string; count: number; lat?: number | null; lng?: number | null }>;
  countries: string[];
  // engagement signals (also populated from the same feed call)
  avg_likes: number | null;
  avg_comments: number | null;
  avg_views: number | null;
  engagement_rate: number | null;             // (likes + comments) / followers, %
  posts_per_week: number | null;
  last_post_at: string | null;                // ISO
  top_hashtags: Array<{ tag: string; count: number }>;
  brand_mentions: string[];                   // @mentions in captions
  // raw per-post snapshot for UI / debugging
  posts: Array<{
    code: string;
    timestamp: string;
    likes: number | null;
    comments: number | null;
    views: number | null;
    caption_excerpt: string | null;
    location: string | null;
    media_type: string;
  }>;
}

async function fetchGeoSignals(
  driver: DriverHandle,
  handle: string,
  followerCount: number | null,
): Promise<GeoSignals | null> {
  const data = await driver.page.evaluate(async (h: string) => {
    const g: any = globalThis;
    if (typeof g.__name !== 'function') g.__name = (fn: unknown) => fn;
    const headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'X-IG-App-ID': '936619743392459',
    };
    try {
      // web_profile_info returns the user's recent timeline posts inline,
      // avoiding the need for a separate /feed/user/ call (which often
      // returns empty for non-business accounts in the newer IG API).
      const pr = await fetch(
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
        { headers, credentials: 'include' },
      );
      if (!pr.ok) return { error: `web_profile_info HTTP ${pr.status}` };
      const pj = await pr.json();
      const user = pj?.data?.user;
      if (!user) return { error: 'no user' };

      // Try multiple edge sources — IG moved some accounts to newer fields
      let edges = (user?.edge_owner_to_timeline_media?.edges ?? []) as Array<{ node: any }>;
      if (edges.length === 0) {
        edges = (user?.edge_felix_video_timeline?.edges ?? []) as Array<{ node: any }>;
      }

      // If still empty, try the v1 feed API as fallback
      if (edges.length === 0) {
        try {
          const userId = user?.id;
          if (userId) {
            const feedRes = await fetch(
              `/api/v1/feed/user/${userId}/?count=12`,
              { headers, credentials: 'include' },
            );
            if (feedRes.ok) {
              const feedJson = await feedRes.json();
              const items = feedJson?.items ?? [];
              const feedOut: any[] = [];
              for (const item of items.slice(0, 12)) {
                feedOut.push({
                  code: item.code ?? null,
                  taken_at: typeof item.taken_at === 'number' ? item.taken_at : null,
                  like_count: typeof item.like_count === 'number' ? item.like_count : null,
                  comment_count: typeof item.comment_count === 'number' ? item.comment_count : null,
                  view_count: typeof item.play_count === 'number' ? item.play_count
                               : typeof item.view_count === 'number' ? item.view_count : null,
                  caption: item.caption?.text ?? null,
                  location_name: item.location?.name ?? null,
                  location_lat: typeof item.location?.lat === 'number' ? item.location.lat : null,
                  location_lng: typeof item.location?.lng === 'number' ? item.location.lng : null,
                  media_type: item.media_type === 2 ? 'video' : item.media_type === 8 ? 'carousel' : 'image',
                  product_type: item.product_type ?? null,
                });
              }
              return { posts: feedOut, source: 'v1_feed' };
            }
          }
        } catch { /* fallthrough */ }
        return { error: `0 edges from all sources, user keys: ${Object.keys(user).slice(0, 10).join(',')}` };
      }

      const out: any[] = [];
      for (const e of edges.slice(0, 12)) {
        const n = e?.node;
        if (!n) continue;
        const loc = n.location ?? null;
        const captionEdges = n.edge_media_to_caption?.edges ?? [];
        const caption = captionEdges[0]?.node?.text ?? null;
        out.push({
          code: n.shortcode ?? n.code ?? null,
          taken_at: typeof n.taken_at_timestamp === 'number' ? n.taken_at_timestamp : null,
          like_count: typeof n.edge_liked_by?.count === 'number' ? n.edge_liked_by.count
                       : typeof n.edge_media_preview_like?.count === 'number' ? n.edge_media_preview_like.count
                       : null,
          comment_count: typeof n.edge_media_to_comment?.count === 'number' ? n.edge_media_to_comment.count : null,
          view_count: typeof n.video_view_count === 'number' ? n.video_view_count
                       : typeof n.video_play_count === 'number' ? n.video_play_count : null,
          caption,
          location_name: loc?.name ? String(loc.name) : null,
          location_lat: typeof loc?.lat === 'number' ? loc.lat : null,
          location_lng: typeof loc?.lng === 'number' ? loc.lng : null,
          media_type: n.is_video ? 'video' : (n.__typename === 'GraphSidecar' ? 'carousel' : 'image'),
          product_type: n.product_type ?? null,
        });
      }
      return { posts: out };
    } catch (err) {
      return { error: String(err) };
    }
  }, handle);

  if (!data || (data as { error?: string }).error) {
    console.warn(`[profile-scraper] ${handle}: geo feed returned`, JSON.stringify(data).slice(0, 200));
    return null;
  }
  const rawPosts = ((data as { posts?: Array<{
    code: string | null;
    taken_at: number | null;
    like_count: number | null;
    comment_count: number | null;
    view_count: number | null;
    caption: string | null;
    location_name: string | null;
    location_lat: number | null;
    location_lng: number | null;
    media_type: string;
    product_type: string | null;
  }> }).posts) ?? [];
  if (rawPosts.length === 0) {
    console.warn(`[profile-scraper] ${handle}: web_profile_info returned 0 posts (edges empty — login may be stale or account may block API)`);
    return null;
  }

  // Aggregate location-bearing posts. Normalise to primary city.
  const cityCounts = new Map<string, { count: number; lat?: number | null; lng?: number | null }>();
  let withLoc = 0;
  for (const p of rawPosts) {
    if (!p.location_name) continue;
    withLoc++;
    const cityKey = p.location_name.split(',')[0]!.trim();
    const existing = cityCounts.get(cityKey);
    if (existing) existing.count++;
    else cityCounts.set(cityKey, { count: 1, lat: p.location_lat, lng: p.location_lng });
  }
  const top_cities = Array.from(cityCounts.entries())
    .map(([name, v]) => ({ name, count: v.count, lat: v.lat ?? null, lng: v.lng ?? null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Engagement aggregates
  const likes = rawPosts.map((p) => p.like_count).filter((x): x is number => typeof x === 'number');
  const comments = rawPosts.map((p) => p.comment_count).filter((x): x is number => typeof x === 'number');
  const views = rawPosts.map((p) => p.view_count).filter((x): x is number => typeof x === 'number');
  const avg_likes = likes.length ? Math.round(likes.reduce((a, b) => a + b, 0) / likes.length) : null;
  const avg_comments = comments.length ? Math.round(comments.reduce((a, b) => a + b, 0) / comments.length) : null;
  const avg_views = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : null;
  const engagement_rate =
    followerCount && followerCount > 0 && avg_likes != null
      ? Math.round(((avg_likes + (avg_comments ?? 0)) / followerCount) * 10000) / 100  // pct, 2dp
      : null;

  // Posting cadence
  const timestamps = rawPosts.map((p) => p.taken_at).filter((t): t is number => typeof t === 'number').sort((a, b) => b - a);
  let posts_per_week: number | null = null;
  let last_post_at: string | null = null;
  if (timestamps.length >= 2) {
    last_post_at = new Date(timestamps[0]! * 1000).toISOString();
    const spanSeconds = timestamps[0]! - timestamps[timestamps.length - 1]!;
    if (spanSeconds > 0) {
      const weeks = spanSeconds / (7 * 24 * 3600);
      posts_per_week = weeks > 0 ? Math.round((timestamps.length / weeks) * 10) / 10 : null;
    }
  } else if (timestamps.length === 1) {
    last_post_at = new Date(timestamps[0]! * 1000).toISOString();
  }

  // Hashtag + brand-mention extraction from captions
  const hashtagCounts = new Map<string, number>();
  const mentionSet = new Set<string>();
  for (const p of rawPosts) {
    if (!p.caption) continue;
    const tags = p.caption.match(/#[A-Za-z0-9_]+/g) ?? [];
    for (const t of tags) {
      const lower = t.slice(1).toLowerCase();
      hashtagCounts.set(lower, (hashtagCounts.get(lower) ?? 0) + 1);
    }
    const mentions = p.caption.match(/@[A-Za-z0-9_.]+/g) ?? [];
    for (const m of mentions) mentionSet.add(m.slice(1).toLowerCase());
  }
  const top_hashtags = Array.from(hashtagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag, count]) => ({ tag, count }));

  // Per-post snapshot for UI
  const posts = rawPosts.map((p) => ({
    code: p.code ?? '',
    timestamp: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : '',
    likes: p.like_count,
    comments: p.comment_count,
    views: p.view_count,
    caption_excerpt: p.caption ? p.caption.slice(0, 240) : null,
    location: p.location_name,
    media_type: p.media_type,
  }));

  return {
    posts_sampled: rawPosts.length,
    posts_with_location: withLoc,
    top_cities,
    countries: [],
    avg_likes,
    avg_comments,
    avg_views,
    engagement_rate,
    posts_per_week,
    last_post_at,
    top_hashtags,
    brand_mentions: Array.from(mentionSet).slice(0, 20),
    posts,
  };
}
