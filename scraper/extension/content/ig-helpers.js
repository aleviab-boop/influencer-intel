// ============================================================
// Helpers for Instagram DOM parsing.
// Selectors target IG's public profile structure as of late 2025.
// IG ships frequent changes — when extraction breaks, update the
// SELECTORS object first; underlying logic should still work.
// ============================================================

window.__IGI = window.__IGI || {};

window.__IGI.SELECTORS = {
  // Profile header
  username: 'header section h2',
  displayName: 'header section h1',
  bio: 'header section > div > div > div > span',
  followerStat:
    'header section ul li:nth-child(2) a span span, header section ul li:nth-child(2) span span',
  followingStat:
    'header section ul li:nth-child(3) a span span, header section ul li:nth-child(3) span span',
  postsStat: 'header section ul li:nth-child(1) span span',
  verifiedBadge: 'header section svg[aria-label*="Verified"]',
  profilePhoto: 'header img',

  // Posts grid
  postLinks: 'article a[href*="/p/"], article a[href*="/reel/"]',

  // Post page (when navigated to)
  postCaption: 'article div[role="dialog"] h1, article header + div h2',
  postLikes: 'article section span',
};

window.__IGI.getCleanText = function (el) {
  if (!el) return null;
  const clone = el.cloneNode(true);
  // Strip hidden popover content (IG's pattern)
  clone.querySelectorAll('[popover], [aria-hidden="true"]').forEach((n) => n.remove());
  return clone.textContent?.trim() || null;
};

window.__IGI.parseAbbreviatedNumber = function (text) {
  if (!text) return null;
  const cleaned = text.toString().toLowerCase().replace(/,/g, '').trim();
  const match = cleaned.match(/^([\d.]+)\s*([kmb])?/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const mult = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2] ?? ''] ?? 1;
  return Math.round(num * mult);
};

window.__IGI.handleFromUrl = function (url) {
  const m = url.match(/instagram\.com\/([^/?#]+)/);
  return m ? m[1] : null;
};

window.__IGI.firstText = function (selectors) {
  for (const sel of selectors.split(',').map((s) => s.trim())) {
    const el = document.querySelector(sel);
    if (el) {
      const t = window.__IGI.getCleanText(el);
      if (t) return t;
    }
  }
  return null;
};

window.__IGI.allHrefs = function (selector) {
  return Array.from(document.querySelectorAll(selector))
    .map((a) => a.getAttribute('href'))
    .filter((h) => typeof h === 'string');
};

window.__IGI.waitForElement = function (selector, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const start = Date.now();
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      } else if (Date.now() - start > timeoutMs) {
        observer.disconnect();
        resolve(null);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
};
