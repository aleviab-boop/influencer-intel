// Shared home-IP og: proxy client.
//
// Instagram serves the public link-preview og: tags (name, follower/post counts,
// profile pic, per-post likes/comments) to a social-crawler UA — but ONLY to
// residential IPs. From Vercel's data-center IP the payload comes back blank. So
// on the server we route the og: PAGE fetch through a tiny home-IP proxy
// (tools/og-relay.mjs) whose URL lives in system_config.og_proxy_url, SEPARATE
// from the throttle-prone `relay_url`. That proxy ONLY fetches profile/post PAGES
// with the crawler UA (no cookies, no /api/ endpoint), so it can never touch the
// rate-limited web_profile_info or burn an account.
//
// This module was extracted from app/api/ig-profile/route.ts so other routes
// (e.g. /api/ig-avatar) can reuse the SAME free path instead of the throttle-
// prone web_profile_info endpoint.
import { getBolticClient } from '@influencer-intel/shared/db';

// Social-crawler UA that makes IG serve the link-preview og: tags (not the JS
// app shell). Used for the direct (local-dev) fetch; the proxy forces its own.
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const OG_RELAY_KEY = process.env.IG_OG_RELAY_KEY?.trim() ?? '';

// og:image / og:title arrive HTML-encoded (`&amp;` between CDN signature params).
// Left as-is they corrupt the signature (`oh`/`oe`) and the image 403s. Decode so
// it actually loads. amp LAST so we never double-decode.
export const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; } })
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

export const ogMeta = (body: string, prop: string): string | null =>
  body.match(new RegExp(`<meta property="${prop}" content="([^"]+)"`))?.[1] ?? null;

export const ogImage = (body: string): string | null => {
  const u = ogMeta(body, 'og:image');
  return u ? decodeEntities(u) : null;
};

// Cached ~60s so this adds at most ~1 DB read/min. Env IG_OG_RELAY is a static
// fallback for when the DB value isn't set.
let ogProxyCache: { at: number; url: string | undefined } | null = null;
export async function ogProxyUrl(): Promise<string | undefined> {
  if (ogProxyCache && Date.now() - ogProxyCache.at < 60_000) return ogProxyCache.url;
  let url = process.env.IG_OG_RELAY?.trim() || undefined;
  try {
    const rows = await getBolticClient().query<{ value: string | null }>(
      `SELECT value FROM system_config WHERE key = 'og_proxy_url'`,
    );
    const dbUrl = rows[0]?.value?.trim();
    if (dbUrl) url = dbUrl; // DB wins (self-updates when the tunnel churns)
  } catch {
    /* DB down → keep env fallback */
  }
  ogProxyCache = { at: Date.now(), url };
  return url;
}

// Fetch an Instagram profile/post PAGE for its og: tags. Goes through the home-IP
// og proxy when configured (so it works from Vercel), else direct (works locally).
// Returns the HTML body on a 2xx, or null on any failure/non-2xx.
export async function ogFetch(igUrl: string, timeoutMs = 10_000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const proxy = await ogProxyUrl();
    let res: Response;
    if (proxy) {
      res = await fetch(proxy, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...(OG_RELAY_KEY ? { 'x-relay-key': OG_RELAY_KEY } : {}),
        },
        body: JSON.stringify({ url: igUrl }),
        signal: ctrl.signal,
      });
    } else {
      res = await fetch(igUrl, { headers: { 'User-Agent': CRAWLER_UA, Accept: 'text/html' }, signal: ctrl.signal });
    }
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Convenience: fetch a creator's profile page through the og proxy and return the
// decoded profile-photo (og:image) URL, or null. FREE + un-throttled + cookieless
// — never hits web_profile_info, so it works even while that endpoint is in
// cooldown.
export async function fetchProfileOgImage(handle: string): Promise<string | null> {
  const body = await ogFetch(`https://www.instagram.com/${encodeURIComponent(handle)}/`, 10_000);
  if (!body) return null;
  return ogImage(body);
}
