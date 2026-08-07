// ============================================================
// Media-kit builder (DB-only fallback).
//
// The live media kit is assembled from a fresh Instagram pull (/api/creator/
// analytics). But a creator who hasn't connected — or whose token has gone
// stale — should still get a shareable one-pager, because everything a brand
// needs (reach, engagement, niche, top posts, audience split) is already stored
// on the `creators` row we discovered them from. This reshapes that stored row
// into the SAME payload shape the analytics endpoint returns, tagged
// `source: 'db'` so the UI can show a "from your saved profile" note.
//
// Pure and deterministic: no writes, no network, no ML/LLM. Postgres hands back
// NUMERIC/BIGINT as strings, so every number is coerced before use.
// ============================================================

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---- Stored shapes (loose — JSONB is best-effort) --------------------------

interface RecentPost {
  platform_post_id?: string;
  post_url?: string;
  post_type?: string;   // 'reel' | 'carousel' | 'image' | 'video' | ...
  caption?: string;
  thumbnail_url?: string;
  media_url?: string;
  view_count?: number | string;
  like_count?: number | string;
  comment_count?: number | string;
}
interface Demographics {
  gender?: { male?: number | string; female?: number | string; other_pct?: number | string };
  age_bands?: Record<string, number | string>;   // e.g. { "18_24": 32, "25_34": 41 }
  top_cities?: { city?: string; pct?: number | string }[];
}
interface Credibility {
  overall_score?: number | string;
  badge?: string;
}

export interface MediaKitCreatorRow {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  profile_photo_url: string | null;
  is_verified: boolean | null;
  primary_category: string | null;
  primary_city: string | null;
  follower_count: number | string | null;
  following_count: number | string | null;
  posts_count: number | string | null;
  avg_likes: number | string | null;
  avg_views: number | string | null;
  engagement_rate: number | string | null;
  recent_posts: RecentPost[] | null;
  audience_demographics: Demographics | null;
  credibility: Credibility | null;
}

// ---- Output (mirrors /api/creator/analytics, the subset the media kit reads) -

export interface MediaKitPayload {
  connected: boolean;
  source: 'db';
  profile: {
    username: string;
    name: string | null;
    biography: string | null;
    followers_count: number | null;
    follows_count: number | null;
    media_count: number | null;
    profile_picture_url: string | null;
  };
  stats: { avg_er: number | null; avg_reach: number | null; avg_reel_plays: number | null; avg_likes: number | null };
  cadence: { posts_per_week: number | null };
  posts: {
    id: string; permalink: string; media_type: string;
    thumbnail_url: string | null; media_url: string | null;
    like_count: number; comments_count: number; er: number | null; plays: number | null;
  }[];
  demographics: { gender_age: Record<string, number>; cities: Record<string, number> } | null;
  audience_quality: { available: boolean; score: number | null; grade: string | null };
  media_value: null;
  niche: string | null;
  city: string | null;
}

const REEL_TYPES = new Set(['reel', 'reels', 'video']);

function mediaTypeFor(t: string | undefined): string {
  const s = (t ?? '').toLowerCase();
  if (REEL_TYPES.has(s)) return 'REELS';
  if (s === 'carousel' || s === 'carousel_album') return 'CAROUSEL_ALBUM';
  return 'IMAGE';
}

function ageLabel(key: string): string {
  // "18_24" -> "18–24", "45_64" -> "45–64", "65_plus" -> "65+"
  const m = key.match(/^(\d+)[_-](\d+)$/);
  if (m) return `${m[1]}–${m[2]}`;
  if (/plus/i.test(key)) return key.replace(/[_-]?plus/i, '+');
  return key.replace(/_/g, '–');
}

function gradeFor(score: number | null, badge: string | undefined): string | null {
  if (badge) return badge;
  if (score == null) return null;
  return score >= 80 ? 'Excellent' : score >= 65 ? 'Strong' : score >= 50 ? 'Fair' : 'Building';
}

/**
 * Reshape a stored `creators` row into the media-kit payload. Returns a payload
 * with `connected: true` so the page renders it exactly like the live kit,
 * distinguished only by `source: 'db'`.
 */
export function buildMediaKit(row: MediaKitCreatorRow): MediaKitPayload {
  const followers = numOrNull(row.follower_count);
  const er = numOrNull(row.engagement_rate);
  const avgLikes = numOrNull(row.avg_likes);
  const avgViews = numOrNull(row.avg_views);

  // Top posts by engagement, computed from stored counts.
  const posts: MediaKitPayload['posts'] = (row.recent_posts ?? [])
    .map((p, i) => {
      const likes = num(p.like_count);
      const comments = num(p.comment_count);
      const plays = numOrNull(p.view_count);
      const postEr = followers && followers > 0 ? (likes + comments) / followers : null;
      return {
        id: p.platform_post_id ?? `db-${i}`,
        permalink: p.post_url ?? `https://instagram.com/${row.handle}`,
        media_type: mediaTypeFor(p.post_type),
        thumbnail_url: p.thumbnail_url ?? null,
        media_url: p.media_url ?? null,
        like_count: likes,
        comments_count: comments,
        er: postEr,
        plays,
      };
    })
    .filter((p) => p.like_count > 0 || p.comments_count > 0 || p.plays != null);

  // Demographics — normalise stored splits into the { key: weight } shape the
  // page renders (it computes its own percentages, so raw weights are fine).
  const demo = row.audience_demographics;
  const cities: Record<string, number> = {};
  for (const c of demo?.top_cities ?? []) {
    if (c?.city) cities[c.city] = num(c.pct);
  }
  const genderAge: Record<string, number> = {};
  for (const [k, v] of Object.entries(demo?.age_bands ?? {})) {
    genderAge[ageLabel(k)] = num(v);
  }
  const hasDemo = Object.keys(cities).length > 0 || Object.keys(genderAge).length > 0;

  const credScore = numOrNull(row.credibility?.overall_score);

  return {
    connected: true,
    source: 'db',
    profile: {
      username: row.handle,
      name: row.display_name,
      biography: row.bio,
      followers_count: followers,
      follows_count: numOrNull(row.following_count),
      media_count: numOrNull(row.posts_count),
      profile_picture_url: row.profile_photo_url,
    },
    stats: {
      avg_er: er,
      avg_reach: null,          // reach needs live insights; don't fabricate
      avg_reel_plays: avgViews,
      avg_likes: avgLikes,
    },
    cadence: { posts_per_week: null },
    posts,
    demographics: hasDemo ? { gender_age: genderAge, cities } : null,
    audience_quality: {
      available: credScore != null,
      score: credScore != null ? Math.round(credScore) : null,
      grade: gradeFor(credScore != null ? Math.round(credScore) : null, row.credibility?.badge),
    },
    media_value: null,
    niche: row.primary_category,
    city: row.primary_city,
  };
}
