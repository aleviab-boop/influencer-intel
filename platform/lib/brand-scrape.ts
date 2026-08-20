// Real, first-party scraping for the brand-onboarding flow. Instead of handing
// the LLM only a brand NAME (which makes it guess/hallucinate), we actually
// fetch the brand's website AND its Instagram profile, distil them to plain
// text/structured facts, and feed THAT to `analyzeBrandDna`. Two exports:
//
//   scrapeBrandSite(url)      → title + meta + visible copy from the homepage
//   scrapeBrandInstagram(hnd) → bio, category, reach, recent captions, and the
//                               @handles the brand tags (its past collaborators)
//
// Both are best-effort: any failure returns null / empty so the DNA flow still
// runs on whatever we DID get (even just the name).

import { igFetch } from './ig-fetch';

const APP_ID = '936619743392459';

// Node's fetch (undici) auto-adds Sec-Fetch-* headers IG rejects; override them
// so the request looks like a same-origin XHR. Mirrors the ig-profile route.
const IG_HEADERS: Record<string, string> = {
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

// ── Website ────────────────────────────────────────────────────────────────

export interface SiteScrape {
  url: string;
  title: string;
  description: string; // meta description / og:description
  text: string; // visible body copy, stripped + capped
}

// Pull the content of a meta tag by name or property, tolerating attribute order.
function metaContent(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x?[0-9a-f]+;/gi, ' ');
}

// Strip a full HTML document down to the visible, meaningful copy: drop script/
// style/nav/svg, unwrap tags, collapse whitespace. Not a perfect renderer — just
// enough signal (headlines, product copy, about text) for the model to ground on.
function htmlToText(html: string): string {
  return decodeEntities(
    html
      // Remove whole non-content blocks.
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Turn block boundaries into spaces so words don't glue together.
      .replace(/<\/(p|div|li|h[1-6]|section|header|footer|br|tr)>/gi, ' ')
      // Drop all remaining tags.
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalise a user-typed URL (add https://, tolerate a bare domain).
function normaliseUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function scrapeBrandSite(rawUrl: string, maxChars = 6000): Promise<SiteScrape | null> {
  const url = normaliseUrl(rawUrl);
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('html') && ct) return null;
    const html = (await res.text()).slice(0, 400_000); // cap the raw doc we parse
    const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
    const description = metaContent(html, 'description') || metaContent(html, 'og:description');
    const text = htmlToText(html).slice(0, maxChars);
    if (!title && !description && text.length < 40) return null; // nothing usable
    return { url, title, description, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Instagram ────────────────────────────────────────────────────────────────

interface IgMediaNode {
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
}
interface IgUser {
  username?: string;
  full_name?: string;
  biography?: string;
  category_name?: string;
  external_url?: string | null;
  edge_followed_by?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number; edges?: Array<{ node?: IgMediaNode }> };
}

export interface InstagramScrape {
  handle: string;
  full_name: string;
  biography: string;
  category: string;
  external_url: string | null;
  followers: number;
  posts: number;
  captions: string[]; // recent post captions (trimmed)
  mentions: Array<{ handle: string; count: number }>; // @handles the brand tags = collaborators
}

// Extract a clean IG handle from a handle, @handle, or profile URL.
function normaliseHandle(raw: string): string | null {
  let h = raw.trim();
  const urlMatch = h.match(/instagram\.com\/([^/?#]+)/i);
  if (urlMatch) h = urlMatch[1]!;
  h = h.replace(/^@/, '').trim();
  return /^[a-z0-9._]{1,30}$/i.test(h) ? h : null;
}

export async function scrapeBrandInstagram(rawHandle: string): Promise<InstagramScrape | null> {
  const handle = normaliseHandle(rawHandle);
  if (!handle) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await igFetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      { headers: IG_HEADERS, signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { user?: IgUser } };
    const u = json?.data?.user;
    if (!u || !u.username) return null;

    const edges = u.edge_owner_to_timeline_media?.edges ?? [];
    const captions = edges
      .map((e) => e.node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? '')
      .filter(Boolean)
      .map((c) => c.slice(0, 280));

    // @mentions across the brand's own captions = the creators it collaborates
    // with / tags. Count and rank; exclude the brand's own handle.
    const mentionCount = new Map<string, number>();
    for (const cap of captions) {
      for (const m of cap.matchAll(/@([a-z0-9_.]{2,30})/gi)) {
        const h = m[1]!.toLowerCase();
        if (h !== handle.toLowerCase()) mentionCount.set(h, (mentionCount.get(h) ?? 0) + 1);
      }
    }
    const mentions = Array.from(mentionCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([h, count]) => ({ handle: h, count }));

    return {
      handle: u.username,
      full_name: u.full_name ?? '',
      biography: u.biography ?? '',
      category: u.category_name ?? '',
      external_url: u.external_url ?? null,
      followers: u.edge_followed_by?.count ?? 0,
      posts: u.edge_owner_to_timeline_media?.count ?? 0,
      captions,
      mentions,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
