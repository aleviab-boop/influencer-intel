// ============================================================
// Instagram profile extractor — comprehensive version.
// Pulls 50+ fields from a profile page using:
//   1. <meta property="og:*"> tags (reliable, structured)
//   2. DOM elements (bio, category, external link, post grid)
//   3. Computed/derived fields (tier, ratios, language guess)
// ============================================================

(function () {
  if (window.__IGI_INIT) return;
  window.__IGI_INIT = true;

  const { handleFromUrl, waitForElement, parseAbbreviatedNumber } = window.__IGI;

  function isProfilePage() {
    const path = window.location.pathname;
    const reserved = new Set([
      '', 'explore', 'reels', 'direct', 'accounts', 'p', 'reel', 'tv', 'stories', 'web',
      'about', 'developer', 'press', 'jobs', 'privacy', 'terms', 'help',
    ]);
    const segment = path.split('/').filter(Boolean)[0];
    return segment !== undefined && !reserved.has(segment) && !path.includes('/p/') && !path.includes('/reel/');
  }

  /** Pull a meta tag's content. */
  function meta(prop) {
    return document.querySelector(`meta[property="${prop}"]`)?.getAttribute('content')
      ?? document.querySelector(`meta[name="${prop}"]`)?.getAttribute('content')
      ?? null;
  }

  /**
   * Parse the og:description format used by IG, e.g.:
   *   "199 followers, 9 following, 67 posts – see Instagram photos and videos from SHREYA VAID BURAD (@styledbyshreya)"
   */
  function parseOgDescription(d) {
    if (!d) return null;
    const stats = { follower_count: null, following_count: null, posts_count: null, display_name: null, handle: null };
    const followers = d.match(/([\d,.]+\s*[KkMm]?)\s+followers?/i);
    const following = d.match(/([\d,.]+\s*[KkMm]?)\s+following/i);
    const posts = d.match(/([\d,.]+\s*[KkMm]?)\s+posts?/i);
    if (followers) stats.follower_count = parseAbbreviatedNumber(followers[1]);
    if (following) stats.following_count = parseAbbreviatedNumber(following[1]);
    if (posts) stats.posts_count = parseAbbreviatedNumber(posts[1]);
    const fromMatch = d.match(/from\s+(.+?)\s+\(@([a-z0-9_.]+)\)/i);
    if (fromMatch) {
      stats.display_name = fromMatch[1].trim();
      stats.handle = fromMatch[2].trim().toLowerCase();
    }
    return stats;
  }

  /** Parse og:title format: "DISPLAY (@handle) • Instagram photos and videos" */
  function parseOgTitle(t) {
    if (!t) return null;
    const m = t.match(/^(.+?)\s+\(@([a-z0-9_.]+)\)/i);
    if (!m) return null;
    return { display_name: m[1].trim(), handle: m[2].trim().toLowerCase() };
  }

  /** Extract bio text from the header section. */
  function extractBio() {
    // IG renders bio in a <h1> sibling and link/category as separate els.
    // We collect candidate text blobs from header section and pick the
    // most "bio-like" one (medium length, no Follow/Message buttons).
    const candidates = Array.from(
      document.querySelectorAll('header section h1, header section span, header section div')
    )
      .map((el) => el.innerText?.trim() ?? '')
      .filter((t) => t.length >= 5 && t.length <= 500)
      .filter((t) => !/^(Follow|Following|Message|Edit profile|posts?|followers?|following)$/i.test(t.trim()))
      .filter((t) => !/^\d+\s+(posts?|followers?|following)$/i.test(t));
    // Bio is usually the longest candidate after stripping handle/displayname duplicates
    const handle = handleFromUrl(window.location.href);
    const filtered = candidates.filter((t) => t.toLowerCase() !== handle?.toLowerCase());
    if (filtered.length === 0) return null;
    return filtered.reduce((a, b) => (b.length > a.length ? b : a));
  }

  /** Extract first external link in bio, if any. */
  function extractExternalLink() {
    const a = document.querySelector('header section a[href^="https://l.instagram.com"], header section a[target="_blank"][href^="http"]');
    if (!a) return null;
    let href = a.getAttribute('href') ?? null;
    // IG wraps external URLs through l.instagram.com/?u=ENCODED
    if (href?.includes('l.instagram.com')) {
      try {
        const u = new URL(href);
        const real = u.searchParams.get('u');
        if (real) href = decodeURIComponent(real);
      } catch {}
    }
    return href;
  }

  /** Extract business category badge (Public figure, Brand, Education, etc.). */
  function extractCategory() {
    const a = document.querySelector('header section a[href^="/explore/"]');
    return a?.innerText?.trim() ?? null;
  }

  /** Extract recent post URLs + types. */
  function extractRecentPosts() {
    const links = Array.from(document.querySelectorAll('article a[href*="/p/"], article a[href*="/reel/"]'));
    return links.slice(0, 12).map((a) => {
      const href = a.getAttribute('href') ?? '';
      const m = href.match(/\/(p|reel|tv)\/([^/?#]+)/);
      const isReel = href.includes('/reel/');
      // Try to read alt text on inner image — sometimes contains likes/views info
      const img = a.querySelector('img');
      return {
        platform_post_id: m ? m[2] : href,
        post_url: href.startsWith('http') ? href : `https://www.instagram.com${href}`,
        post_type: isReel ? 'reel' : 'post',
        thumbnail_url: img?.getAttribute('src') ?? null,
        alt_text: img?.getAttribute('alt') ?? null,
        caption: null,
        posted_at: null,
        view_count: null,
        like_count: null,
        comment_count: null,
      };
    });
  }

  /** Count visible story highlights. */
  function extractHighlightsCount() {
    return document.querySelectorAll('header ~ section ul li, header section ul ~ ul li, ul[role="tablist"] li').length || 0;
  }

  /** Detect verified badge. */
  function isVerified() {
    return !!document.querySelector('header section svg[aria-label*="Verified"]');
  }

  /** Detect "Professional account" type badges. */
  function extractAccountType() {
    const text = document.body.innerText.slice(0, 4000);
    if (text.includes('Public figure')) return 'public_figure';
    if (text.includes('Personal blog')) return 'personal_blog';
    if (text.includes('Creator')) return 'creator';
    if (text.includes('Business')) return 'business';
    return null;
  }

  /** Heuristic: does the bio/name suggest Indian audience focus? */
  function inferIsIndian(displayName, bio, externalLink) {
    const text = `${displayName ?? ''} ${bio ?? ''} ${externalLink ?? ''}`.toLowerCase();
    const india_keywords = [
      'india', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'pune', 'kolkata',
      'chennai', 'hyderabad', 'jaipur', 'lucknow', 'ahmedabad', 'chandigarh',
      'desi', 'indian', 'bharat', 'hindi', 'marathi', 'tamil', 'telugu', 'gujarati',
      'in 🇮🇳', '🇮🇳',
    ];
    return india_keywords.some((k) => text.includes(k)) || /\.in($|\/|\?)/.test(externalLink ?? '');
  }

  /** Detect the dominant content language from bio + display name. */
  function inferLanguage(displayName, bio) {
    const text = `${displayName ?? ''} ${bio ?? ''}`;
    if (/[ऀ-ॿ]/.test(text)) return 'hi'; // Devanagari → Hindi/Marathi
    if (/[஀-௿]/.test(text)) return 'ta'; // Tamil
    if (/[ఀ-౿]/.test(text)) return 'te'; // Telugu
    if (/[ঀ-৿]/.test(text)) return 'bn'; // Bengali
    if (/[઀-૿]/.test(text)) return 'gu'; // Gujarati
    if (/[ಀ-೿]/.test(text)) return 'kn'; // Kannada
    if (/[਀-੿]/.test(text)) return 'pa'; // Punjabi
    if (/[ഀ-ൿ]/.test(text)) return 'ml'; // Malayalam
    return 'en';
  }

  /** Classify creator tier by follower count. */
  function classifyTier(followers) {
    if (followers === null) return null;
    if (followers >= 1_000_000) return 'mega';
    if (followers >= 100_000) return 'macro';
    if (followers >= 10_000) return 'micro';
    return 'nano';
  }

  /** Compute follower-to-following ratio (signal for fake-followers). */
  function followerRatio(followers, following) {
    if (!followers || !following) return null;
    return Math.round((followers / following) * 100) / 100;
  }

  let lastExtracted = null;
  let extractTimer = null;

  async function extractProfile() {
    if (!isProfilePage()) return;
    const handle = handleFromUrl(window.location.href);
    if (!handle) return;
    if (lastExtracted === handle) return;

    // Wait for header DOM to be present
    await waitForElement('header section', 8_000);
    // Brief settle for JS-rendered counts
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

    const bio = extractBio();
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

    const payload = {
      handle: (fromDesc?.handle ?? fromTitle?.handle ?? handle).replace(/^@/, '').toLowerCase().trim(),
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
      hashtags_seen: [],
      og: {
        title: ogTitle,
        description: ogDesc,
        image: ogImage,
        url: ogUrl,
      },
      page_url: window.location.href,
      extracted_at: new Date().toISOString(),
    };

    lastExtracted = handle;
    console.log('[ig-extractor]', payload.handle, '→', payload.follower_count, 'followers');
    chrome.runtime.sendMessage({ type: 'EXTRACT_RESULT', payload }, (resp) => {
      if (chrome.runtime.lastError) {
        console.error('[ig-extractor] sendMessage failed', chrome.runtime.lastError);
      }
    });
  }

  function scheduleExtract() {
    if (extractTimer) clearTimeout(extractTimer);
    extractTimer = setTimeout(extractProfile, 1500);
  }

  scheduleExtract();

  let lastHref = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      lastExtracted = null;
      scheduleExtract();
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.addEventListener('IGI_EXTRACT_NOW', () => {
    lastExtracted = null;
    scheduleExtract();
  });
})();
