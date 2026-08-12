// ============================================================
// Live post metrics by URL — pull the current likes/comments/views of a single
// public post so a recorded outcome can be auto-filled instead of typed in.
//
// It reuses the existing profile scraper (which already handles the relay /
// cookie-pool / Apify fallback) and matches the post by shortcode within the
// creator's recent posts. That means it only works for reasonably RECENT posts
// (the ones still on the first page of the grid) — which is exactly the window
// in which you'd be recording a forecast's actual result. Best-effort: returns
// { found: false } rather than throwing when the post can't be resolved.
// ============================================================

import { fetchInstagramProfile } from './instagram-scraper';

// Pull the shortcode out of an Instagram post/reel URL.
export function extractShortcode(url: string): string | null {
  const m = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

export interface LivePostMetrics {
  found: boolean;
  shortcode: string | null;
  like_count: number | null;
  comment_count: number | null;
  view_count: number | null;
  post_type: 'reel' | 'photo' | 'carousel' | null;
  posted_at: string | null;
}

const NOT_FOUND: LivePostMetrics = {
  found: false, shortcode: null, like_count: null, comment_count: null,
  view_count: null, post_type: null, posted_at: null,
};

/**
 * Resolve a single post's live metrics from its URL, using the creator's handle
 * to scrape their profile and match the shortcode. Never throws.
 */
export async function fetchPostMetricsByUrl(handle: string, postUrl: string): Promise<LivePostMetrics> {
  const shortcode = extractShortcode(postUrl);
  if (!handle || !shortcode) return { ...NOT_FOUND, shortcode };
  try {
    const profile = await fetchInstagramProfile(handle);
    const post = profile.recent_posts.find(
      (p) => p.platform_post_id === shortcode || p.post_url.includes(`/${shortcode}`),
    );
    if (!post) return { ...NOT_FOUND, shortcode };
    const type: LivePostMetrics['post_type'] =
      post.post_type === 'video' ? 'reel' : post.post_type === 'carousel' ? 'carousel' : 'photo';
    return {
      found: true,
      shortcode,
      like_count: post.like_count > 0 ? post.like_count : null,
      comment_count: post.comment_count >= 0 ? post.comment_count : null,
      view_count: post.view_count > 0 ? post.view_count : null,
      post_type: type,
      posted_at: post.posted_at,
    };
  } catch {
    // Scrape blocked / handle not found / timeout → let the caller fall back to
    // manual entry.
    return { ...NOT_FOUND, shortcode };
  }
}
