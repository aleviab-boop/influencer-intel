import { NextRequest, NextResponse, after } from 'next/server';
import { extractContact } from '@/lib/live-discovery';
import {
  toPostSample,
  analyzeAuthenticity,
  analyzePosting,
  topHashtags,
  campaignFit,
} from '@/lib/creator-analytics';
import { igFetch } from '@/lib/ig-fetch';
import { apifyProfileOrNull } from '@/lib/apify';
import type { ScrapedProfile } from '@/lib/instagram-scraper';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 30; // headroom for the on-the-fly audience estimate

// GET /api/ig-profile?handle=X
//   Powers the profile drawer. HYBRID model:
//   - The browser worker (scraper workspace) DISCOVERS handles and writes basic
//     creator rows during a crawl. It no longer deep-scrapes each creator.
//   - This endpoint fetches the RICH view (followers, recent posts, live ER,
//     reel-forecast inputs) on demand via the COOKIE scraper (igFetch, through a
//     residential relay/proxy so it works from Vercel). That live payload is what
//     the drawer renders, and we persist it back into `creators` so the DB stays
//     warm.
//   - If the live fetch fails (no relay configured, 401/429, network), we fall
//     back to whatever the DB already has (source 'db'). Deep scraping has been
//     removed from the browser worker entirely, so we no longer enqueue a worker
//     refresh here — the cookie scraper IS the deep-scrape path.

const APP_ID = '936619743392459';
const PROFILE_URL = (u: string) =>
  `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(u)}`;

// Node's fetch (undici) auto-adds Sec-Fetch-* headers IG rejects with a "400
// SecFetch Policy violation"; override them to look like a same-origin XHR.
const REQUEST_HEADERS: Record<string, string> = {
  'x-ig-app-id': APP_ID,
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.instagram.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

// ---- live cookie fetch (web_profile_info gives profile + recent posts) ------

interface MediaNode {
  shortcode?: string;
  is_video?: boolean;
  taken_at_timestamp?: number;
  display_url?: string;
  thumbnail_src?: string;
  video_view_count?: number;
  edge_liked_by?: { count?: number };
  edge_media_preview_like?: { count?: number };
  edge_media_to_comment?: { count?: number };
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
}
interface LiveUser {
  id?: string;
  username?: string;
  full_name?: string;
  biography?: string;
  category_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  profile_pic_url_hd?: string;
  profile_pic_url?: string;
  external_url?: string | null;
  business_email?: string | null;
  public_email?: string | null;
  edge_followed_by?: { count?: number };
  edge_follow?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number; edges?: Array<{ node?: MediaNode }> };
  edge_related_profiles?: {
    edges?: Array<{
      node?: {
        username?: string;
        full_name?: string;
        is_verified?: boolean;
        profile_pic_url?: string;
      };
    }>;
  };
}

// Returns the live user when available, plus `notFound` = IG DEFINITIVELY says
// this handle doesn't exist (404, or 200 with a null user). That's distinct from
// a throttle (401/429/network), where the account may well be real — we must NOT
// prune on those. Only a definitive not-found lets us clean up a hallucinated stub.
async function fetchLiveUser(handle: string): Promise<{ user: LiveUser | null; notFound: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await igFetch(PROFILE_URL(handle), {
      headers: REQUEST_HEADERS,
      signal: ctrl.signal,
    });
    if (res.status === 404) return { user: null, notFound: true }; // confirmed gone
    if (!res.ok) return { user: null, notFound: false }; // 401 (no cookie) / 429 → throttle, keep
    const json = (await res.json()) as { data?: { user?: LiveUser } };
    const user = json?.data?.user ?? null;
    return { user, notFound: user == null }; // 200 but no user → also confirmed gone
  } catch {
    return { user: null, notFound: false }; // network error / abort / relay down → throttle, keep
  } finally {
    clearTimeout(timer);
  }
}

// A stub we couldn't verify at discovery time just came back DEFINITIVELY 404 on
// enrichment → it was an AI hallucination. Soft-delete it (is_active = false) so
// it drops out of search, but ONLY if it's a sparse, never-enriched scrape stub.
// A real creator (has reach, was scraped before, richer data, or is curated) is
// never touched — a transient 404 on them shouldn't wipe them.
async function pruneHallucinatedStub(handle: string): Promise<void> {
  try {
    await getBolticClient().query(
      `UPDATE creators SET is_active = false
       WHERE platform = 'instagram' AND lower(handle) = lower($1)
         AND is_active = true
         AND source = 'scrape'                    -- never curated / imported / icmp
         AND last_scraped_at IS NULL              -- never successfully enriched
         AND coalesce(follower_count, 0) = 0      -- no real reach on record
         AND coalesce(data_completeness, 0) <= 3  -- a sparse stub, not a full row`,
      [handle],
    );
  } catch {
    /* best-effort cleanup — never break the request */
  }
}

function captionOf(node: MediaNode): string {
  return node.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
}

// Coerce a loosely-typed stored value (number, or a NUMERIC/BIGINT string from
// pg, or undefined) into a finite number. Post engagement is sometimes persisted
// as a string, which silently reads as 0 under a `typeof === 'number'` check.
function coerceNum(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

// ---- audience demographics --------------------------------------------------
// The drawer's "Audience demographics" panel. Reconciles the TWO shapes stored
// in creators.audience_demographics (a `json` column):
//   • vision_inference   → gender {male, female, other}          (confidence med)
//   • inferred_scraping   → gender {male_pct, female_pct, other_pct} (conf low)
// Both also carry age_bands, top_cities[{city,pct}], top_languages[{lang,pct}],
// country_india_pct, confidence, sample_size, source. We normalize to ONE shape
// so the UI renders identically, and drop rows that came back empty (failed
// scrapes with sample_size 0 and all-null values) → the panel simply hides.
export interface AudienceDemographics {
  available: boolean;
  source: string | null;
  confidence: string | null;
  sample_size: number | null;
  gender: { female: number; male: number; other: number } | null;
  age_bands: { label: string; pct: number }[];
  top_cities: { city: string; pct: number }[];
  top_languages: { lang: string; pct: number }[];
  country_india_pct: number | null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const AGE_LABELS: Record<string, string> = {
  '13_17': '13–17', '18_24': '18–24', '25_34': '25–34', '35_44': '35–44', '45_64': '45–64', '65_plus': '65+',
};

function normalizeDemographics(raw: unknown): AudienceDemographics | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const g = (d.gender ?? {}) as Record<string, unknown>;

  const female = numOrNull(g.female ?? g.female_pct);
  const male = numOrNull(g.male ?? g.male_pct);
  const other = numOrNull(g.other ?? g.other_pct);
  const gender = female != null || male != null
    ? { female: female ?? 0, male: male ?? 0, other: other ?? 0 }
    : null;

  const ageRaw = (d.age_bands ?? {}) as Record<string, unknown>;
  const age_bands = Object.entries(ageRaw)
    .map(([k, v]) => ({ label: AGE_LABELS[k] ?? k.replace(/_/g, '–'), pct: numOrNull(v) ?? 0 }))
    .filter((a) => a.pct > 0);

  const top_cities = Array.isArray(d.top_cities)
    ? (d.top_cities as Array<Record<string, unknown>>)
        .map((c) => ({ city: String(c.city ?? c.name ?? '').trim(), pct: numOrNull(c.pct ?? c.share_pct) ?? 0 }))
        .filter((c) => c.city && c.pct > 0)
        .slice(0, 6)
    : [];

  const top_languages = Array.isArray(d.top_languages)
    ? (d.top_languages as Array<Record<string, unknown>>)
        .map((l) => ({ lang: String(l.lang ?? l.name ?? '').trim(), pct: numOrNull(l.pct) ?? 0 }))
        .filter((l) => l.lang && l.pct > 0)
        .slice(0, 5)
    : [];

  const country_india_pct = numOrNull(d.country_india_pct);
  const sample_size = numOrNull(d.sample_size);

  // Hide rows that carry no real signal (failed/empty scrapes).
  if (!gender && top_cities.length === 0 && age_bands.length === 0) return null;

  return {
    available: true,
    source: typeof d.source === 'string' ? d.source : null,
    confidence: typeof d.confidence === 'string' ? d.confidence : null,
    sample_size,
    gender,
    age_bands,
    top_cities,
    top_languages,
    country_india_pct,
  };
}

// One indexed lookup by handle → normalized demographics (or null). Best-effort:
// a demographics hiccup must never break the drawer.
async function loadDemographics(handle: string): Promise<AudienceDemographics | null> {
  try {
    const rows = await getBolticClient().query<{ audience_demographics: unknown }>(
      `SELECT audience_demographics FROM creators
       WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
    return normalizeDemographics(rows[0]?.audience_demographics ?? null);
  } catch {
    return null;
  }
}

// Cache an on-the-fly estimate back onto the creator row so the next open is
// instant and other surfaces (search, media kit) benefit. Guarded to NULL so an
// estimate NEVER clobbers a real vision/follower-sampled blob. No-op for a brand
// -new handle with no row yet — a later open persists it once the row exists.
async function persistDemographics(handle: string, blob: Record<string, unknown>): Promise<void> {
  try {
    await getBolticClient().query(
      `UPDATE creators SET audience_demographics = $1::json
       WHERE platform = 'instagram' AND lower(handle) = lower($2)
         AND audience_demographics IS NULL`,
      [JSON.stringify(blob), handle],
    );
  } catch {
    /* best-effort cache write */
  }
}

// The "mandatory demographics" path. If the DB already has a demographics blob
// (real follower-sampled or a prior estimate), use it. Otherwise ESTIMATE from
// the creator's own content (bio + niche + captions) via gpt-4o-mini — so EVERY
// profile opened shows an audience read, even a brand-new handle never saved.
// Content estimates are labelled source:'content_inference' + low/medium
// confidence so the UI badges them honestly. Never throws.
async function resolveDemographics(
  handle: string,
  existing: AudienceDemographics | null,
  content: {
    display_name?: string | null;
    bio?: string | null;
    category?: string | null;
    follower_count?: number | null;
    captions?: string[];
  },
): Promise<AudienceDemographics | null> {
  if (existing) return existing;
  const captions = (content.captions ?? []).filter((c) => (c ?? '').trim().length >= 4);
  const hasSignal = (content.bio ?? '').trim().length > 0 || captions.length > 0;
  if (!hasSignal) return null; // nothing to estimate from → hide rather than hallucinate
  try {
    const blob = await getOpenAIClient().inferAudienceFromContent({
      handle,
      display_name: content.display_name ?? null,
      bio: content.bio ?? null,
      category: content.category ?? null,
      follower_count: content.follower_count ?? null,
      captions,
    });
    if (!blob) return null;
    const normalized = normalizeDemographics(blob);
    if (normalized) after(() => persistDemographics(handle, blob));
    return normalized;
  } catch {
    return null;
  }
}

interface RecentPost {
  shortcode: string;
  thumbnail: string | null;
  likes: number;
  comments: number;
  is_video: boolean;
  taken_at: number | null;
  caption: string;
}

// Compute the deterministic analytics block the drawer renders — authenticity /
// fake-engagement, posting behaviour, top hashtags and a campaign-fit score — all
// from the raw recent posts we already fetched. Shared by the DB, live and Apify
// response paths so every drawer shows the same panels. nicheMatch is null here
// (a per-profile view has no brief), so campaign fit weights ER + reach +
// authenticity and treats niche as neutral.
function buildAnalytics(followers: number, recent: RecentPost[]) {
  const samples = recent.map(toPostSample);
  const authenticity = analyzeAuthenticity(followers, samples);
  return {
    authenticity,
    posting: analyzePosting(samples),
    hashtags: topHashtags(samples),
    campaign_fit: campaignFit({
      followers,
      er: authenticity.er,
      nicheMatch: null,
      authenticityScore: authenticity.score,
    }),
  };
}

interface FeedItem {
  code?: string;
  media_type?: number; // 1 image, 2 video, 8 carousel
  taken_at?: number;
  like_count?: number;
  comment_count?: number;
  caption?: { text?: string } | null;
  image_versions2?: { candidates?: Array<{ url?: string }> };
  carousel_media?: Array<{ image_versions2?: { candidates?: Array<{ url?: string }> } }>;
}

// web_profile_info frequently returns the profile but an EMPTY posts array once a
// session is warmed/used — so when we get no post edges we pull them from the
// user-feed endpoint, which reliably returns the recent posts (likes, comments,
// thumbnails) for the reel forecast + posts grid.
async function fetchUserFeed(userId: string): Promise<RecentPost[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await igFetch(
      `https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/?count=12`,
      { headers: REQUEST_HEADERS, signal: ctrl.signal },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as { items?: FeedItem[] };
    return (j?.items ?? []).map((it) => {
      const cands = it.image_versions2?.candidates ?? it.carousel_media?.[0]?.image_versions2?.candidates ?? [];
      return {
        shortcode: it.code ?? '',
        thumbnail: cands[cands.length - 1]?.url ?? cands[0]?.url ?? null,
        likes: typeof it.like_count === 'number' ? it.like_count : 0,
        comments: typeof it.comment_count === 'number' ? it.comment_count : 0,
        is_video: it.media_type === 2,
        taken_at: typeof it.taken_at === 'number' ? it.taken_at : null,
        caption: (it.caption?.text ?? '').slice(0, 200),
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Persist a live payload so the DB stays warm and the Lander's DB search can
// surface this creator later. Best-effort: never let a persist error break the
// drawer. We only UPDATE rows that already exist (discovery inserts the shell);
// for a brand-new handle we insert a minimal row with a CHECK-valid source.
async function persistLive(handle: string, u: LiveUser, er: number | null, geoPosts: unknown[]) {
  const db = getBolticClient();
  const patch: Record<string, unknown> = {
    display_name: u.full_name ?? '',
    bio: u.biography ?? '',
    follower_count: u.edge_followed_by?.count ?? 0,
    following_count: u.edge_follow?.count ?? 0,
    posts_count: u.edge_owner_to_timeline_media?.count ?? 0,
    is_verified: Boolean(u.is_verified),
    profile_photo_url: u.profile_pic_url_hd ?? u.profile_pic_url ?? null,
    engagement_rate: er != null ? er / 100 : null,
    raw_metadata: { geo: { posts: geoPosts } },
    last_scraped_at: new Date().toISOString(),
  };
  try {
    const rows = await db.query(
      `SELECT 1 FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
    if (rows.length > 0) {
      await db.update('creators', { handle, platform: 'instagram' }, patch);
    } else {
      await db.insert('creators', {
        handle,
        platform: 'instagram',
        is_active: true,
        source: 'scrape',
        ...patch,
      });
    }
  } catch {
    /* ignore — persistence is a nice-to-have, not required for the drawer */
  }
}

// Worker-discovered "similar" creators from the DB (same niche, nearby reach),
// used when the live payload has no related profiles.
interface RelatedRow {
  handle: string;
  display_name: string | null;
  is_verified: boolean | null;
  profile_photo_url: string | null;
}
async function dbRelated(handle: string, niche: string, followers: number) {
  if (!niche) return [];
  try {
    const rows = await getBolticClient().query<RelatedRow>(
      `SELECT handle, display_name, is_verified, profile_photo_url
       FROM creators
       WHERE platform = 'instagram' AND is_active = true
         AND lower(handle) <> lower($1)
         AND lower(coalesce(primary_category, niche, '')) = lower($2)
       ORDER BY abs(coalesce(follower_count, 0) - $3) ASC
       LIMIT 8`,
      [handle, niche, followers],
    );
    return rows
      .map((r) => ({
        handle: r.handle,
        full_name: r.display_name ?? '',
        is_verified: Boolean(r.is_verified),
        profile_pic_url: r.profile_photo_url ?? null,
      }))
      .filter((r) => r.handle);
  } catch {
    return [];
  }
}

// ---- DB fallback (what the worker discovered / a previous live persist) ------

async function dbProfile(handle: string, demographics: AudienceDemographics | null) {
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await getBolticClient().query<Record<string, unknown>>(
      `SELECT handle, display_name, bio, primary_category, niche, follower_count,
              following_count, posts_count, engagement_rate, profile_photo_url,
              profile_url, is_verified, primary_city, raw_metadata, recent_posts,
              last_scraped_at
       FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
  } catch {
    rows = [];
  }

  const c = rows[0];

  // Not in the DB and the live cookie fetch already failed (relay/proxy down or
  // IG throttled). Nothing to deep-scrape any more — the browser worker is
  // discovery-only. Return an empty shell; the drawer can offer a manual retry.
  if (!c) {
    return NextResponse.json({
      handle,
      full_name: '',
      biography: '',
      category: '',
      followers: 0,
      following: 0,
      posts: 0,
      is_verified: false,
      is_private: false,
      profile_pic_url: null,
      external_url: null,
      email: null,
      phone: null,
      recent: [],
      related: [],
      collabs: [],
      sponsored_posts: 0,
      engagement: null,
      audience_demographics: demographics,
      source: 'pending',
      refreshing: false,
      last_scraped_at: null,
    });
  }

  const bio = (c.bio as string) ?? '';
  const contact = extractContact(bio, { externalUrl: (c.profile_url as string) ?? null });
  const er = c.engagement_rate != null ? Math.round(Number(c.engagement_rate) * 1000) / 10 : null;
  const meta = (c.raw_metadata as Record<string, unknown> | null) ?? {};
  const geo = (meta.geo as Record<string, unknown> | null) ?? {};

  const geoPosts = Array.isArray(geo.posts) ? (geo.posts as Array<Record<string, unknown>>) : [];
  const gridPosts = Array.isArray(c.recent_posts) ? (c.recent_posts as Array<Record<string, unknown>>) : [];
  const thumbByCode = new Map<string, string>();
  for (const g of gridPosts) {
    const url = typeof g.post_url === 'string' ? g.post_url : '';
    const code = (g.platform_post_id as string) || url.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] || '';
    const thumb = (g.thumbnail_url as string) || (g.thumbnail as string) || '';
    if (code && thumb) thumbByCode.set(code, thumb);
  }
  let recent = geoPosts.map((p) => {
    const ts = typeof p.timestamp === 'string' && p.timestamp ? Math.floor(Date.parse(p.timestamp as string) / 1000) : null;
    const code = (p.code as string) ?? '';
    return {
      shortcode: code,
      thumbnail: (typeof p.thumbnail === 'string' && p.thumbnail) ? p.thumbnail : (thumbByCode.get(code) ?? null),
      likes: coerceNum(p.likes),
      comments: coerceNum(p.comments),
      is_video: p.media_type === 'video',
      taken_at: Number.isFinite(ts) ? ts : null,
      caption: (p.caption_excerpt as string) ?? '',
    };
  });
  // geo.posts can exist but carry no engagement (older/partial writes). If it has
  // no likes anywhere but recent_posts does, prefer recent_posts so the drawer's
  // ER + authenticity aren't stuck at zero.
  const geoHasEngagement = recent.some((p) => p.likes > 0 || p.comments > 0);
  if ((recent.length === 0 || !geoHasEngagement) && gridPosts.length > 0) {
    recent = gridPosts.map((g) => {
      const url = typeof g.post_url === 'string' ? g.post_url : '';
      const code =
        (g.shortcode as string) ||
        (g.platform_post_id as string) ||
        url.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ||
        '';
      // recent_posts is stored in two shapes across historical writes:
      //   scraper/Apify shape → { like_count, comment_count, post_type, posted_at }
      //   clean/live shape     → { likes, comments, is_video, taken_at }
      // Read BOTH so DB-served drawers show real engagement instead of zeros.
      const likes = coerceNum(g.like_count ?? g.likes);
      const comments = coerceNum(g.comment_count ?? g.comments);
      const rawTs = g.taken_at ?? g.posted_at ?? g.timestamp;
      let ts: number | null = null;
      if (typeof rawTs === 'number' && Number.isFinite(rawTs)) ts = rawTs;
      else if (typeof rawTs === 'string' && rawTs) {
        const parsed = Math.floor(Date.parse(rawTs) / 1000);
        ts = Number.isFinite(parsed) ? parsed : null;
      }
      return {
        shortcode: code,
        thumbnail: (g.thumbnail_url as string) || (g.thumbnail as string) || null,
        likes,
        comments,
        is_video: g.post_type === 'reel' || g.post_type === 'video' || g.is_video === true,
        taken_at: ts,
        caption: (g.caption as string) ?? (g.caption_excerpt as string) ?? '',
      };
    });
  }

  const collabs = Array.isArray(geo.brand_mentions)
    ? (geo.brand_mentions as string[]).slice(0, 12).map((h) => ({ handle: h, count: 1 }))
    : Array.isArray(meta.collabs)
      ? (meta.collabs as Array<{ handle: string; count: number }>)
      : [];
  const sponsored = typeof meta.sponsored_posts === 'number' ? meta.sponsored_posts : 0;
  const niche = ((c.primary_category as string) || (c.niche as string)) ?? '';
  const followers = Number(c.follower_count ?? 0);

  const related = await dbRelated(handle, niche, followers);

  // Mandatory audience read: stored blob if present, else estimate from the
  // creator's stored bio + post captions.
  const resolvedDemo = await resolveDemographics(handle, demographics, {
    display_name: (c.display_name as string) ?? '',
    bio,
    category: niche,
    follower_count: followers,
    captions: recent.map((p) => p.caption),
  });

  return NextResponse.json({
    handle: c.handle,
    full_name: (c.display_name as string) ?? '',
    biography: bio,
    category: niche,
    followers,
    following: Number(c.following_count ?? 0),
    posts: Number(c.posts_count ?? 0),
    is_verified: Boolean(c.is_verified),
    is_private: false,
    profile_pic_url: (c.profile_photo_url as string) ?? null,
    external_url: contact.link,
    email: contact.email,
    phone: contact.phone,
    recent,
    related,
    collabs,
    sponsored_posts: sponsored,
    engagement: er,
    audience_demographics: resolvedDemo,
    analytics: buildAnalytics(followers, recent),
    source: 'db',
    last_scraped_at: (c.last_scraped_at as string) ?? null,
    refreshing: false,
  });
}

// Shape an Apify ScrapedProfile into the EXACT drawer response the live path
// returns, so the UI renders identically (photo + 12-tile grid with thumbnails).
async function apifyDrawerResponse(handle: string, sp: ScrapedProfile, demographics: AudienceDemographics | null): Promise<NextResponse> {
  const recent: RecentPost[] = sp.recent_posts.map((p) => ({
    shortcode: p.platform_post_id || (p.post_url.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] ?? ''),
    thumbnail: p.thumbnail_url,
    likes: p.like_count,
    comments: p.comment_count,
    is_video: p.post_type === 'video',
    taken_at: p.posted_at ? (Math.floor(Date.parse(p.posted_at) / 1000) || null) : null,
    caption: (p.caption ?? '').slice(0, 200),
  }));

  const bio = sp.biography ?? '';
  const contact = extractContact(bio, { externalUrl: sp.external_url });
  // sp.engagement_rate is a fraction (e.g. 0.016); the drawer wants a percent.
  const er = sp.engagement_rate != null ? Math.round(sp.engagement_rate * 1000) / 10 : null;

  // brand mentions in captions → collabs panel (same derivation as the live path)
  const mentionCount = new Map<string, number>();
  for (const p of recent) {
    for (const m of p.caption.matchAll(/@([a-z0-9_.]{2,30})/gi)) {
      const h = m[1]!.toLowerCase();
      if (h !== handle.toLowerCase()) mentionCount.set(h, (mentionCount.get(h) ?? 0) + 1);
    }
  }
  const collabs = Array.from(mentionCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([h, count]) => ({ handle: h, count }));

  const related = await dbRelated(handle, sp.category ?? '', sp.follower_count);

  // Mandatory audience read: use the stored blob if present, else estimate from
  // this Apify profile's bio + captions.
  const resolvedDemo = await resolveDemographics(handle, demographics, {
    display_name: sp.display_name,
    bio,
    category: sp.category ?? '',
    follower_count: sp.follower_count,
    captions: recent.map((p) => p.caption),
  });

  // Warm the DB copy in the background so a later DB-serve still has the grid.
  after(() => persistApify(handle, sp, er));

  return NextResponse.json({
    handle: sp.handle,
    full_name: sp.display_name ?? '',
    biography: bio,
    category: sp.category ?? '',
    followers: sp.follower_count,
    following: sp.following_count,
    posts: sp.posts_count,
    is_verified: sp.is_verified,
    is_private: false,
    profile_pic_url: sp.profile_photo_url,
    external_url: contact.link ?? sp.external_url,
    email: contact.email,
    phone: contact.phone,
    recent,
    related,
    collabs,
    sponsored_posts: 0,
    engagement: er,
    audience_demographics: resolvedDemo,
    analytics: buildAnalytics(sp.follower_count, recent),
    source: 'live',
    last_scraped_at: new Date().toISOString(),
    refreshing: false,
  });
}

// Persist an Apify-sourced profile back into `creators` (best-effort). Mirrors
// persistLive's shape AND writes recent_posts (with thumbnail_url) so both the
// drawer grid AND the quality scorer have real per-post engagement to work with.
async function persistApify(handle: string, sp: ScrapedProfile, er: number | null): Promise<void> {
  const db = getBolticClient();
  const geoPosts = sp.recent_posts.map((p) => ({
    code: p.platform_post_id,
    thumbnail: p.thumbnail_url,
    likes: p.like_count,
    comments: p.comment_count,
    media_type: p.post_type === 'video' ? 'video' : 'image',
    timestamp: p.posted_at,
    caption_excerpt: (p.caption ?? '').slice(0, 200),
  }));
  const patch: Record<string, unknown> = {
    display_name: sp.display_name ?? '',
    bio: sp.biography ?? '',
    follower_count: sp.follower_count,
    following_count: sp.following_count,
    posts_count: sp.posts_count,
    is_verified: sp.is_verified,
    profile_photo_url: sp.profile_photo_url,
    engagement_rate: er != null ? er / 100 : sp.engagement_rate,
    recent_posts: sp.recent_posts,
    raw_metadata: { geo: { posts: geoPosts } },
    last_scraped_at: new Date().toISOString(),
  };
  try {
    const rows = await db.query(
      `SELECT 1 FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
    if (rows.length > 0) {
      await db.update('creators', { handle, platform: 'instagram' }, patch);
    } else {
      await db.insert('creators', {
        handle,
        platform: 'instagram',
        is_active: true,
        source: 'scrape',
        ...patch,
      });
    }
  } catch {
    /* best-effort — the response already went out */
  }
}

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    return NextResponse.json({ error: 'bad handle' }, { status: 400 });
  }

  // Audience demographics live in the DB regardless of which path serves the
  // drawer, so load them in parallel with the live fetch (no added latency).
  const demoPromise = loadDemographics(handle);

  // 1) LIVE via the cookie scraper (through the residential relay/proxy). This is
  //    the primary path: real followers, recent posts, live ER, reel-forecast
  //    inputs. Falls through to the DB if it fails.
  const { user: u, notFound } = await fetchLiveUser(handle);
  if (u && u.username) {
    const edges = u.edge_owner_to_timeline_media?.edges ?? [];
    const followers = u.edge_followed_by?.count ?? 0;

    // recent posts → drawer grid + reel forecast (forecast derives views from likes)
    let recent: RecentPost[] = edges.map((e) => {
      const n = e.node ?? {};
      const likes = n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0;
      const comments = n.edge_media_to_comment?.count ?? 0;
      const cap = captionOf(n);
      return {
        shortcode: n.shortcode ?? '',
        thumbnail: n.thumbnail_src ?? n.display_url ?? null,
        likes,
        comments,
        is_video: Boolean(n.is_video),
        taken_at: typeof n.taken_at_timestamp === 'number' ? n.taken_at_timestamp : null,
        caption: cap.slice(0, 200),
      };
    });

    // web_profile_info often returns an empty posts array (esp. once the session
    // is warmed) — pull them from the user-feed endpoint so the grid + forecast
    // aren't blank.
    if (recent.length === 0 && u.id) {
      recent = await fetchUserFeed(u.id);
    }

    // live ER = avg((likes+comments)/followers) across recent posts, as a %
    let er: number | null = null;
    if (followers > 0 && recent.length > 0) {
      const avg = recent.reduce((s, p) => s + p.likes + p.comments, 0) / recent.length;
      er = Math.round((avg / followers) * 1000) / 10;
    }

    // brand mentions in captions → collabs panel
    const mentionCount = new Map<string, number>();
    for (const p of recent) {
      for (const m of p.caption.matchAll(/@([a-z0-9_.]{2,30})/gi)) {
        const h = m[1]!.toLowerCase();
        if (h !== handle.toLowerCase()) mentionCount.set(h, (mentionCount.get(h) ?? 0) + 1);
      }
    }
    const collabs = Array.from(mentionCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([h, count]) => ({ handle: h, count }));

    // IG's own related profiles; fall back to DB "similar" if none.
    const bio = u.biography ?? '';
    const niche = u.category_name ?? '';
    let related = (u.edge_related_profiles?.edges ?? [])
      .map((e) => e.node ?? {})
      .filter((n) => n.username)
      .map((n) => ({
        handle: n.username!,
        full_name: n.full_name ?? '',
        is_verified: Boolean(n.is_verified),
        profile_pic_url: n.profile_pic_url ?? null,
      }));
    if (related.length === 0) related = await dbRelated(handle, niche, followers);

    const contact = extractContact(bio, { externalUrl: u.external_url ?? null });

    // persist for the Lander's DB search + drawer warmth (best-effort)
    const geoPosts = recent.map((p) => ({
      code: p.shortcode,
      thumbnail: p.thumbnail,
      likes: p.likes,
      comments: p.comments,
      media_type: p.is_video ? 'video' : 'image',
      timestamp: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : null,
      caption_excerpt: p.caption,
    }));
    await persistLive(handle, u, er, geoPosts);

    // Image-verify gender from the FRESH profile photo (runs after the response
    // is sent, so it adds no latency). Overrides any stale text-inferred label —
    // e.g. a female creator with a male-leaning name ("Mukul") gets corrected.
    const freshPic = u.profile_pic_url_hd ?? u.profile_pic_url ?? null;
    if (freshPic) {
      after(async () => {
        try {
          const g = await getOpenAIClient().inferGendersFromPhotos([{ handle, imageUrl: freshPic }]);
          const gender = g[handle.toLowerCase()];
          if (gender === 'female' || gender === 'male') {
            await getBolticClient().query(
              `UPDATE creators SET gender = $1 WHERE platform = 'instagram' AND lower(handle) = lower($2)`,
              [gender, handle],
            );
          }
        } catch {
          /* best-effort */
        }
      });
    }

    const demographics = await resolveDemographics(handle, await demoPromise, {
      display_name: u.full_name,
      bio,
      category: niche,
      follower_count: followers,
      captions: recent.map((p) => p.caption),
    });

    return NextResponse.json({
      handle: u.username,
      full_name: u.full_name ?? '',
      biography: bio,
      category: niche,
      followers,
      following: u.edge_follow?.count ?? 0,
      posts: u.edge_owner_to_timeline_media?.count ?? 0,
      is_verified: Boolean(u.is_verified),
      is_private: Boolean(u.is_private),
      profile_pic_url: u.profile_pic_url_hd ?? u.profile_pic_url ?? null,
      external_url: contact.link ?? u.external_url ?? null,
      email: contact.email ?? u.business_email ?? u.public_email ?? null,
      phone: contact.phone,
      recent,
      related,
      collabs,
      sponsored_posts: 0,
      engagement: er,
      audience_demographics: demographics,
      analytics: buildAnalytics(followers, recent),
      source: 'live',
      last_scraped_at: new Date().toISOString(),
      refreshing: false,
    });
  }

  // 1b) The free cookie path failed but IG did NOT say the handle is gone (401/
  //     403/429/network → the pool is blocked/throttled, not a real 404). The
  //     account is almost certainly live, so fall through to the PAID Apify actor
  //     BEFORE dropping to the (possibly grid-less) DB row. This is what keeps the
  //     drawer's photo + full 12-post grid rendering during a throttle instead of
  //     going blank. No-op when APIFY_TOKEN is unset (apifyProfileOrNull → null),
  //     so behavior is unchanged for anyone without Apify configured.
  if (!notFound) {
    const sp = await apifyProfileOrNull(handle);
    if (sp) return apifyDrawerResponse(handle, sp, await demoPromise);
  }

  // Live fetch DEFINITIVELY 404'd → if this was an un-enriched hallucinated stub,
  // retire it in the background so it stops polluting future searches.
  if (notFound) after(() => pruneHallucinatedStub(handle));

  // 2) DB fallback (worker-discovered row or a prior live persist).
  return dbProfile(handle, await demoPromise);
}
