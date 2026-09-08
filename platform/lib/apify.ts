// ============================================================
// Apify fallback — PAID, only used when the free path (relay + cookie pool in
// ig-fetch.ts / instagram-scraper.ts) gets blocked by Instagram (401/403/429).
//
// Nothing here runs unless APIFY_TOKEN is set AND the free fetch failed, so the
// bill scales with how often we actually get blocked — not with total volume.
//
//   apifyProfile(handle) → one profile, mapped into the same ScrapedProfile
//                          shape fetchInstagramProfile returns (drop-in).
//   apifyHashtag(tag)    → discovery: fresh handles posting under a hashtag.
//
// Actors (all free to add on Apify, billed per result on run):
//   apify/instagram-api-scraper      (~$0.50 / 1k)  ← DEFAULT: profiles + posts
//   apify/instagram-profile-scraper  (~$1.60 / 1k)  ← classic fallback (usernames)
//   apify/instagram-hashtag-scraper  (~$1.90 / 1k)  ← classic hashtag fallback
//
// The unified `instagram-api-scraper` is ~3–4× cheaper and returns the SAME JSON
// field names as the classic actors (verified against live runs), so it drops in
// with no mapper changes — it only takes a different INPUT (directUrls +
// resultsType, instead of usernames / hashtags). We default to it and keep the
// classic actors one env-flag away: set APIFY_CHEAP_ACTOR=0 to revert instantly.
// ============================================================

import type { ScrapedProfile, ScrapedPost } from './instagram-scraper';

const APIFY_TOKEN = process.env.APIFY_TOKEN?.trim();
const BASE = 'https://api.apify.com/v2/acts';

// Actor slugs (~ is Apify's owner/name separator in the API path).
const API_ACTOR = 'apify~instagram-api-scraper'; // cheap, unified: profiles + posts
const PROFILE_ACTOR = 'apify~instagram-profile-scraper'; // classic profiles (usernames)
const HASHTAG_ACTOR = 'apify~instagram-hashtag-scraper'; // classic hashtag discovery

// Route through the cheap unified actor by default. Flip APIFY_CHEAP_ACTOR=0 to
// fall back to the classic profile/hashtag actors (same output, higher cost).
const USE_CHEAP_ACTOR = process.env.APIFY_CHEAP_ACTOR !== '0';

const igProfileUrl = (h: string) => `https://www.instagram.com/${h}/`;
const igTagUrl = (t: string) => `https://www.instagram.com/explore/tags/${t}/`;

// Fetch profile JSON for one or many handles, from whichever actor is active.
// Cheap actor: directUrls + resultsType 'details'. Classic: usernames. Both
// return the ApifyProfile shape toScrapedProfile expects.
async function runProfileActor(handles: string[], timeoutMs: number): Promise<ApifyProfile[]> {
  if (USE_CHEAP_ACTOR) {
    return runActor<ApifyProfile>(
      API_ACTOR,
      { directUrls: handles.map(igProfileUrl), resultsType: 'details', resultsLimit: 1 },
      timeoutMs,
    );
  }
  return runActor<ApifyProfile>(
    PROFILE_ACTOR,
    { usernames: handles, resultsLimit: handles.length },
    timeoutMs,
  );
}

// Fetch recent posts under a hashtag, from whichever actor is active. Cheap
// actor: the tag's /explore/tags/ URL + resultsType 'posts'. Classic: hashtags[].
// Both return the ApifyHashtagItem shape (ownerUsername/ownerFullName/url/caption);
// the cheap actor omits ownerFollowersCount (fine — follower sort degrades to the
// collab signal, and reach is filled at enrichment).
async function runHashtagActor(tag: string, limit: number): Promise<ApifyHashtagItem[]> {
  if (USE_CHEAP_ACTOR) {
    return runActor<ApifyHashtagItem>(API_ACTOR, {
      directUrls: [igTagUrl(tag)],
      resultsType: 'posts',
      resultsLimit: limit,
    });
  }
  return runActor<ApifyHashtagItem>(HASHTAG_ACTOR, { hashtags: [tag], resultsLimit: limit });
}

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// Run an actor synchronously and get its dataset items back in one call (no
// polling). `run-sync-get-dataset-items` blocks until the run finishes.
async function runActor<T>(actor: string, input: unknown, timeoutMs = 90_000): Promise<T[]> {
  if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN not set');
  const url = `${BASE}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`apify ${actor} returned ${res.status}`);
    return (await res.json()) as T[];
  } finally {
    clearTimeout(t);
  }
}

// ---- Instagram Profile Scraper --------------------------------------------

interface ApifyPost {
  type?: string;
  shortCode?: string;
  url?: string;
  caption?: string;
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  displayUrl?: string; // the grid tile image (Apify's post thumbnail)
  images?: string[]; // sometimes populated instead of displayUrl on carousels
  ownerUsername?: string; // Apify includes tagged/collab posts owned by OTHER accounts
}

interface ApifyProfile {
  username?: string;
  fullName?: string;
  biography?: string;
  profilePicUrlHD?: string;
  profilePicUrl?: string;
  verified?: boolean;
  businessCategoryName?: string;
  externalUrl?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  latestPosts?: ApifyPost[];
}

// Map Apify's profile JSON onto our ScrapedProfile — SAME engagement math as
// fetchInstagramProfile so downstream (quality score, ER filters) sees identical
// numbers regardless of which path produced them.
function toScrapedProfile(u: ApifyProfile, handle: string): ScrapedProfile {
  // Apify's latestPosts mixes in TAGGED/COLLAB posts owned by OTHER accounts — a
  // 500K-like post by a mega-creator can land in a nano-creator's feed and blow up
  // their engagement numbers. Keep only the creator's OWN posts before any math.
  const owner = (u.username ?? handle).toLowerCase();
  const ownPosts = (u.latestPosts ?? [])
    .filter((p) => {
      const o = p.ownerUsername ? p.ownerUsername.toLowerCase() : '';
      return !o || o === owner;
    })
    .slice(0, 12);

  const recent_posts: ScrapedPost[] = ownPosts.map((p) => {
    const kind = (p.type ?? '').toLowerCase();
    return {
      platform_post_id: String(p.shortCode ?? ''),
      post_url: p.url || (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : ''),
      post_type: kind === 'video' ? 'video' : kind === 'sidecar' ? 'carousel' : 'image',
      caption: p.caption ?? null,
      posted_at: p.timestamp ?? null,
      view_count: num(p.videoViewCount),
      like_count: num(p.likesCount),
      comment_count: num(p.commentsCount),
      thumbnail_url: p.displayUrl || (Array.isArray(p.images) ? p.images[0] : null) || null,
    };
  });

  const followers = num(u.followersCount);
  // MEDIAN, not mean — robust to viral-reel spikes and dud posts, which otherwise
  // produce misleading (sometimes impossible: likes > followers) "average" values.
  const median = (arr: number[]): number | null => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
  };
  const avg_likes = median(recent_posts.map((p) => p.like_count).filter((x) => x > 0));
  const avg_comments = median(recent_posts.map((p) => p.comment_count));
  const engagement_rate =
    followers > 0 && (avg_likes != null || avg_comments != null)
      ? ((avg_likes ?? 0) + (avg_comments ?? 0)) / followers
      : null;

  return {
    handle: u.username ?? handle,
    display_name: u.fullName || null,
    biography: u.biography || null,
    profile_photo_url: u.profilePicUrlHD || u.profilePicUrl || null,
    is_verified: !!u.verified,
    category: u.businessCategoryName || null,
    external_url: u.externalUrl || null,
    follower_count: followers,
    following_count: num(u.followsCount),
    posts_count: num(u.postsCount),
    avg_likes,
    avg_comments,
    engagement_rate,
    recent_posts,
  };
}

// Fetch a single profile via Apify. Throws on failure (no token, blocked, etc.).
export async function apifyProfile(rawHandle: string): Promise<ScrapedProfile> {
  const handle = rawHandle.trim().replace(/^@/, '').replace(/\/.*$/, '');
  if (!handle) throw new Error('handle required');
  const items = await runProfileActor([handle], 90_000);
  const u = items.find((x) => x?.username) ?? items[0];
  if (!u?.username) throw new Error('not_found');
  return toScrapedProfile(u, handle);
}

// Safe wrapper for the fallback call site: returns null instead of throwing when
// Apify isn't configured or the run fails — so the caller's original "blocked"
// error still surfaces unchanged when there's no paid net to catch it.
export async function apifyProfileOrNull(rawHandle: string): Promise<ScrapedProfile | null> {
  if (!APIFY_TOKEN) return null;
  try {
    return await apifyProfile(rawHandle);
  } catch {
    return null;
  }
}

const cleanHandle = (h: string): string =>
  h.trim().replace(/^@/, '').replace(/\/.*$/, '').toLowerCase();

// Enrich MANY profiles in ONE actor run. The profile scraper accepts an array of
// usernames and returns them all in a single dataset — so a campaign page of ~24
// seeds costs one run (one cold-start, one billed run) instead of 24. This is the
// throughput fix for the search path: per-profile runs each take 20–60s, so
// enriching seeds one-at-a-time never filled a page within the request budget.
//
// Deliberately a SINGLE, PROVEN run. The campaign path enriches inside a tight
// per-request deadline — the caller (apifyProfilesAsRawUsers) RACES this against
// the budget left after hashtag discovery. Chaining a second actor here (e.g. an
// API-based scraper first, then this as a fallback) stacks two cold-starts; when
// their sum exceeds the race window the race resolves EMPTY, which surfaces to the
// user as from_live:0. One reliable run that finishes inside the window beats a
// faster-on-paper two-run chain that intermittently returns nothing.
// Returns handle→ScrapedProfile for whatever resolved; missing handles are absent.
export async function apifyProfilesBatch(rawHandles: string[]): Promise<Map<string, ScrapedProfile>> {
  const out = new Map<string, ScrapedProfile>();
  if (!APIFY_TOKEN) return out;
  const handles = Array.from(new Set(rawHandles.map(cleanHandle).filter(Boolean)));
  if (handles.length === 0) return out;
  let items: ApifyProfile[];
  try {
    // a big batch legitimately takes longer than a single profile
    items = await runProfileActor(handles, 120_000);
  } catch {
    return out; // no token / blocked / timeout → caller falls back to stubs
  }
  for (const u of items) {
    const h = u?.username?.trim().toLowerCase();
    if (!h) continue;
    out.set(h, toScrapedProfile(u, h));
  }
  return out;
}

// ---- Instagram Hashtag Scraper (discovery) --------------------------------

export interface ApifyHashtagHit {
  handle: string;
  followers: number | null;
  post_url: string | null;
  caption: string | null;
}

interface ApifyHashtagItem {
  ownerUsername?: string;
  ownerFullName?: string;
  url?: string;
  caption?: string;
  ownerFollowersCount?: number;
}

// Discover handles posting under a hashtag. Cheap way to surface NEW creators on
// cold prompts where the login-free crawl returns nothing. De-dupes by handle.
export async function apifyHashtag(tag: string, limit = 50): Promise<ApifyHashtagHit[]> {
  if (!APIFY_TOKEN) return [];
  const clean = tag.trim().replace(/^#/, '');
  if (!clean) return [];
  let items: ApifyHashtagItem[];
  try {
    items = await runHashtagActor(clean, limit);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: ApifyHashtagHit[] = [];
  for (const it of items) {
    const handle = it.ownerUsername?.trim().toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push({
      handle,
      followers: it.ownerFollowersCount != null ? num(it.ownerFollowersCount) : null,
      post_url: it.url ?? null,
      caption: it.caption ?? null,
    });
  }
  return out;
}
