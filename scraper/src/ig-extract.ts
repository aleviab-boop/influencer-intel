// ============================================================
// In-page IG profile extractor — replaces the Chrome extension.
//
// Runs inside `page.evaluate` after navigating to the profile.
// Uses og:meta + DOM scraping (same logic that lived in
// extension/content/ig-extractor.js) to pull 50+ fields.
//
// Returns a fully-shaped ExtensionExtractionResult (we keep the same
// type to avoid breaking downstream consumers).
// ============================================================

import type { ExtensionExtractionResult } from '@influencer-intel/shared/types';
import type { Page } from 'playwright-core';

const EXTRACT_TIMEOUT_MS = 30_000;

export async function extractProfileInPage(
  page: Page,
  handle: string,
): Promise<ExtensionExtractionResult> {
  const result = await page.evaluate(async (h: string) => {
    // tsx wraps named bindings with __name(fn, "displayName") for
    // source-map metadata. Polyfill it as identity.
    const g: any = globalThis;
    if (typeof g.__name !== 'function') g.__name = (fn: unknown) => fn;

    // ----------------- helpers -----------------
    const meta = (prop: string): string | null => {
      const el =
        document.querySelector(`meta[property="${prop}"]`) ||
        document.querySelector(`meta[name="${prop}"]`);
      return el?.getAttribute('content') ?? null;
    };

    const parseAbbreviatedNumber = (s: string): number | null => {
      if (!s) return null;
      const m = s.match(/([\d,.]+)\s*([KkMm])?/);
      if (!m) return null;
      let n = parseFloat(m[1]!.replace(/,/g, ''));
      if (!Number.isFinite(n)) return null;
      if (m[2] === 'K' || m[2] === 'k') n *= 1_000;
      if (m[2] === 'M' || m[2] === 'm') n *= 1_000_000;
      return Math.round(n);
    };

    const handleFromUrl = (url: string): string | null => {
      try {
        const u = new URL(url);
        const seg = u.pathname.split('/').filter(Boolean)[0];
        return seg ? seg.toLowerCase() : null;
      } catch {
        return null;
      }
    };

    const waitForSelector = (sel: string, timeoutMs: number) =>
      new Promise<void>((resolve) => {
        if (document.querySelector(sel)) return resolve();
        const start = Date.now();
        const i = setInterval(() => {
          if (document.querySelector(sel) || Date.now() - start > timeoutMs) {
            clearInterval(i);
            resolve();
          }
        }, 200);
      });

    const parseOgDescription = (d: string | null) => {
      if (!d) return null;
      const stats = {
        follower_count: null as number | null,
        following_count: null as number | null,
        posts_count: null as number | null,
        display_name: null as string | null,
        handle: null as string | null,
      };
      const followers = d.match(/([\d,.]+\s*[KkMm]?)\s+followers?/i);
      const following = d.match(/([\d,.]+\s*[KkMm]?)\s+following/i);
      const posts = d.match(/([\d,.]+\s*[KkMm]?)\s+posts?/i);
      if (followers) stats.follower_count = parseAbbreviatedNumber(followers[1]!);
      if (following) stats.following_count = parseAbbreviatedNumber(following[1]!);
      if (posts) stats.posts_count = parseAbbreviatedNumber(posts[1]!);
      const fromMatch = d.match(/from\s+(.+?)\s+\(@([a-z0-9_.]+)\)/i);
      if (fromMatch) {
        stats.display_name = fromMatch[1]!.trim();
        stats.handle = fromMatch[2]!.trim().toLowerCase();
      }
      return stats;
    };

    const parseOgTitle = (t: string | null) => {
      if (!t) return null;
      const m = t.match(/^(.+?)\s+\(@([a-z0-9_.]+)\)/i);
      if (!m) return null;
      return { display_name: m[1]!.trim(), handle: m[2]!.trim().toLowerCase() };
    };

    const extractBio = (handleArg: string | null): string | null => {
      const candidates = Array.from(
        document.querySelectorAll('header section h1, header section span, header section div'),
      )
        .map((el) => (el as HTMLElement).innerText?.trim() ?? '')
        .filter((t) => t.length >= 5 && t.length <= 500)
        .filter((t) =>
          !/^(Follow|Following|Message|Edit profile|posts?|followers?|following)$/i.test(t.trim()),
        )
        .filter((t) => !/^\d+\s+(posts?|followers?|following)$/i.test(t));
      const filtered = candidates.filter((t) => t.toLowerCase() !== (handleArg ?? '').toLowerCase());
      if (filtered.length === 0) return null;
      return filtered.reduce((a, b) => (b.length > a.length ? b : a));
    };

    const extractExternalLink = (): string | null => {
      const a =
        document.querySelector('header section a[href^="https://l.instagram.com"]') ||
        document.querySelector('header section a[target="_blank"][href^="http"]');
      if (!a) return null;
      let href = a.getAttribute('href') ?? null;
      if (href && href.includes('l.instagram.com')) {
        try {
          const u = new URL(href);
          const real = u.searchParams.get('u');
          if (real) href = decodeURIComponent(real);
        } catch {}
      }
      return href;
    };

    const extractCategory = (): string | null => {
      const a = document.querySelector('header section a[href^="/explore/"]') as HTMLElement | null;
      return a?.innerText?.trim() ?? null;
    };

    const extractRecentPosts = () => {
      const links = Array.from(
        document.querySelectorAll('article a[href*="/p/"], article a[href*="/reel/"]'),
      );
      return links.slice(0, 12).map((a) => {
        const href = a.getAttribute('href') ?? '';
        const m = href.match(/\/(p|reel|tv)\/([^/?#]+)/);
        const isReel = href.includes('/reel/');
        const img = a.querySelector('img');
        return {
          platform_post_id: m ? m[2]! : href,
          post_url: href.startsWith('http') ? href : `https://www.instagram.com${href}`,
          post_type: (isReel ? 'reel' : 'post') as 'reel' | 'post',
          thumbnail_url: img?.getAttribute('src') ?? null,
          alt_text: img?.getAttribute('alt') ?? null,
          caption: null,
          posted_at: null,
          view_count: null,
          like_count: null,
          comment_count: null,
        };
      });
    };

    const extractHighlightsCount = (): number =>
      document.querySelectorAll(
        'header ~ section ul li, header section ul ~ ul li, ul[role="tablist"] li',
      ).length || 0;

    const isVerified = (): boolean =>
      !!document.querySelector('header section svg[aria-label*="Verified"]');

    const extractAccountType = (): string | null => {
      const text = document.body.innerText.slice(0, 4000);
      if (text.includes('Public figure')) return 'public_figure';
      if (text.includes('Personal blog')) return 'personal_blog';
      if (text.includes('Creator')) return 'creator';
      if (text.includes('Business')) return 'business';
      return null;
    };

    const inferIsIndian = (
      displayName: string | null,
      bio: string | null,
      externalLink: string | null,
    ): boolean => {
      const text = `${displayName ?? ''} ${bio ?? ''} ${externalLink ?? ''}`.toLowerCase();
      const india_keywords = [
        'india', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'pune', 'kolkata',
        'chennai', 'hyderabad', 'jaipur', 'lucknow', 'ahmedabad', 'chandigarh',
        'desi', 'indian', 'bharat', 'hindi', 'marathi', 'tamil', 'telugu', 'gujarati',
        'in 🇮🇳', '🇮🇳',
      ];
      return india_keywords.some((k) => text.includes(k)) ||
        /\.in($|\/|\?)/.test(externalLink ?? '');
    };

    const inferLanguage = (displayName: string | null, bio: string | null): string => {
      const text = `${displayName ?? ''} ${bio ?? ''}`;
      if (/[ऀ-ॿ]/.test(text)) return 'hi';
      if (/[஀-௿]/.test(text)) return 'ta';
      if (/[ఀ-౿]/.test(text)) return 'te';
      if (/[ঀ-৿]/.test(text)) return 'bn';
      if (/[઀-૿]/.test(text)) return 'gu';
      if (/[ಀ-೿]/.test(text)) return 'kn';
      if (/[਀-੿]/.test(text)) return 'pa';
      if (/[ഀ-ൿ]/.test(text)) return 'ml';
      return 'en';
    };

    const classifyTier = (followers: number | null): string | null => {
      if (followers === null) return null;
      if (followers >= 1_000_000) return 'mega';
      if (followers >= 100_000) return 'macro';
      if (followers >= 10_000) return 'micro';
      return 'nano';
    };

    const followerRatio = (followers: number | null, following: number | null): number | null => {
      if (!followers || !following) return null;
      return Math.round((followers / following) * 100) / 100;
    };

    // ----------------- main extraction -----------------
    await waitForSelector('header section', 8_000);
    await new Promise((r) => setTimeout(r, 1500));

    const ogTitle = meta('og:title');
    const ogDesc = meta('og:description');
    const ogImage = meta('og:image');
    const ogUrl = meta('og:url');

    const fromTitle = parseOgTitle(ogTitle);
    const fromDesc = parseOgDescription(ogDesc);

    const displayName = fromTitle?.display_name ?? fromDesc?.display_name ?? null;
    const followerCount = fromDesc?.follower_count ?? null;
    const followingCount = fromDesc?.following_count ?? null;
    const postsCount = fromDesc?.posts_count ?? null;

    const urlHandle = handleFromUrl(window.location.href) ?? h;
    const bio = extractBio(urlHandle);
    const externalLink = extractExternalLink();
    const category = extractCategory();
    const verified = isVerified();
    const accountType = extractAccountType();
    const recentPosts = extractRecentPosts();
    const highlightsCount = extractHighlightsCount();
    const tier = classifyTier(followerCount);
    const ratio = followerRatio(followerCount, followingCount);
    const isIndian = inferIsIndian(displayName, bio, externalLink);
    const language = inferLanguage(displayName, bio);

    const reelCount = recentPosts.filter((p) => p.post_type === 'reel').length;
    const postCountInGrid = recentPosts.filter((p) => p.post_type === 'post').length;

    const finalHandle = (fromDesc?.handle ?? fromTitle?.handle ?? urlHandle ?? h)
      .replace(/^@/, '')
      .toLowerCase()
      .trim();

    return {
      handle: finalHandle,
      platform_user_id: null,
      display_name: displayName,
      bio,
      profile_photo_url: ogImage,
      is_verified: verified,
      follower_count: followerCount,
      following_count: followingCount,
      posts_count: postsCount,
      external_link: externalLink,
      category,
      account_type: accountType,
      tier,
      follower_to_following_ratio: ratio,
      highlights_count: highlightsCount,
      reel_count_in_grid: reelCount,
      post_count_in_grid: postCountInGrid,
      is_indian_inferred: isIndian,
      language_inferred: language,
      recent_posts: recentPosts,
      hashtags_seen: [] as string[],
      og: {
        title: ogTitle,
        description: ogDesc,
        image: ogImage,
        url: ogUrl,
      },
      page_url: window.location.href,
      extracted_at: new Date().toISOString(),
    };
  }, handle);

  return result as ExtensionExtractionResult;
}

export const __extractTimeoutMs = EXTRACT_TIMEOUT_MS;
