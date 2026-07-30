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
// Actors used (both free to add on Apify, billed per result on run):
//   apify/instagram-profile-scraper  (~$2.30 / 1k profiles)
//   apify/instagram-hashtag-scraper  (compute-unit billed)
// ============================================================

import type { ScrapedProfile, ScrapedPost } from './instagram-scraper';

const APIFY_TOKEN = process.env.APIFY_TOKEN?.trim();
const BASE = 'https://api.apify.com/v2/acts';

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
  const recent_posts: ScrapedPost[] = (u.latestPosts ?? []).slice(0, 12).map((p) => {
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
    };
  });

  const followers = num(u.followersCount);
  const withLikes = recent_posts.filter((p) => p.like_count > 0);
  const avg_likes = withLikes.length
    ? Math.round(withLikes.reduce((s, p) => s + p.like_count, 0) / withLikes.length)
    : null;
  const avg_comments = recent_posts.length
    ? Math.round(recent_posts.reduce((s, p) => s + p.comment_count, 0) / recent_posts.length)
    : null;
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
  const items = await runActor<ApifyProfile>('apify~instagram-profile-scraper', {
    usernames: [handle],
    resultsLimit: 1,
  });
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
    items = await runActor<ApifyHashtagItem>('apify~instagram-hashtag-scraper', {
      hashtags: [clean],
      resultsLimit: limit,
    });
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
