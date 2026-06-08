// ============================================================
// Free Instagram profile scraper — uses Instagram's own public web endpoint
// (web_profile_info), no login, no API key. Works for fetching ANY public
// profile by handle: followers, bio, recent posts (likes/comments/views).
//
// LIMITS: a single server IP gets rate-limited/blocked by Instagram after a
// number of requests (no proxy pool = no scale). Good for on-demand lookups,
// not bulk crawling. Instagram's *search* endpoint is login-gated (401), so
// keyword discovery of unknown accounts is NOT available on this free path.
// ============================================================

const IG_APP_ID = '936619743392459'; // public Instagram web app id
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ScrapedPost {
  platform_post_id: string;
  post_url: string;
  post_type: 'image' | 'video' | 'carousel';
  caption: string | null;
  posted_at: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
}

export interface ScrapedProfile {
  handle: string;
  display_name: string | null;
  biography: string | null;
  profile_photo_url: string | null;
  is_verified: boolean;
  category: string | null;
  external_url: string | null;
  follower_count: number;
  following_count: number;
  posts_count: number;
  avg_likes: number | null;
  avg_comments: number | null;
  engagement_rate: number | null;
  recent_posts: ScrapedPost[];
}

const num = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export async function fetchInstagramProfile(rawHandle: string): Promise<ScrapedProfile> {
  const handle = rawHandle.trim().replace(/^@/, '').replace(/\/.*$/, '');
  if (!handle) throw new Error('handle required');

  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'user-agent': UA,
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        // Instagram fingerprints non-browser clients — these make Node's fetch
        // look like the real web app (a missing Referer alone returns HTTP 400).
        referer: `https://www.instagram.com/${handle}/`,
        'x-requested-with': 'XMLHttpRequest',
        'x-ig-www-claim': '0',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      },
    });
  } finally {
    clearTimeout(t);
  }
  if (res.status === 404) throw new Error('not_found');
  if (res.status === 401 || res.status === 403 || res.status === 429) throw new Error('blocked');
  if (!res.ok) throw new Error(`instagram returned ${res.status}`);

  const json = await res.json().catch(() => null);
  const u = json?.data?.user;
  if (!u) throw new Error('not_found');

  const edges = u.edge_owner_to_timeline_media?.edges ?? [];
  const recent_posts: ScrapedPost[] = edges.slice(0, 12).map((e: { node: Record<string, unknown> }) => {
    const node = e.node as Record<string, unknown>;
    const likes = num((node.edge_liked_by as { count?: number })?.count);
    const comments = num((node.edge_media_to_comment as { count?: number })?.count);
    const caption = ((node.edge_media_to_caption as { edges?: { node?: { text?: string } }[] })?.edges?.[0]?.node?.text) ?? null;
    const ts = num(node.taken_at_timestamp);
    return {
      platform_post_id: String(node.shortcode ?? ''),
      post_url: node.shortcode ? `https://www.instagram.com/p/${node.shortcode}/` : '',
      post_type: node.is_video ? 'video' : (node.__typename === 'GraphSidecar' ? 'carousel' : 'image'),
      caption,
      posted_at: ts ? new Date(ts * 1000).toISOString() : null,
      view_count: num(node.video_view_count),
      like_count: likes,
      comment_count: comments,
    };
  });

  const followers = num(u.edge_followed_by?.count);
  const withLikes = recent_posts.filter((p) => p.like_count > 0);
  const avg_likes = withLikes.length ? Math.round(withLikes.reduce((s, p) => s + p.like_count, 0) / withLikes.length) : null;
  const avg_comments = recent_posts.length ? Math.round(recent_posts.reduce((s, p) => s + p.comment_count, 0) / recent_posts.length) : null;
  const engagement_rate = followers > 0 && (avg_likes != null || avg_comments != null)
    ? ((avg_likes ?? 0) + (avg_comments ?? 0)) / followers
    : null;

  return {
    handle: u.username ?? handle,
    display_name: u.full_name || null,
    biography: u.biography || null,
    profile_photo_url: u.profile_pic_url_hd || u.profile_pic_url || null,
    is_verified: !!u.is_verified,
    category: u.category_name || u.category || null,
    external_url: u.external_url || null,
    follower_count: followers,
    following_count: num(u.edge_follow?.count),
    posts_count: num(u.edge_owner_to_timeline_media?.count),
    avg_likes,
    avg_comments,
    engagement_rate,
    recent_posts,
  };
}
