// ============================================================
// Live, login-free Instagram discovery (TS port of ig_hybrid.py).
//
// Instagram blocks keyword *search* unless logged in, but it serves a PUBLIC
// profile's JSON (bio, followers, recent posts, related accounts) to anyone via
// the web_profile_info endpoint + the public web app-id header. So we start from
// one or more seed handles and expand outward:
//
//   seed -> its "related profiles" + @mentions in recent captions
//        -> their related profiles + mentions -> ... (bounded by depth/max)
//
// Every discovered profile is scored against the prompt tokens (e.g. "nagpur",
// "fashion") by how many appear in its name / bio / category. No login, no
// account, no ban risk — just public data + polite throttling.
// ============================================================

const APP_ID = '936619743392459';
const PROFILE_URL = (u: string) =>
  `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(u)}`;

// Node's fetch (undici) auto-adds Sec-Fetch-* headers that Instagram rejects
// with "400 SecFetch Policy violation". We override them to look like a
// same-origin XHR from instagram.com, which the endpoint accepts.
const REQUEST_HEADERS: Record<string, string> = {
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

const MENTION_RE = /@([A-Za-z0-9_.]{2,30})/g;
const STOPWORDS = new Set([
  'in', 'for', 'the', 'and', 'with', 'a', 'an', 'of', 'to', 'on', 'at',
  'who', 'that', 'this', 'season', 'creators', 'creator', 'influencer',
  'influencers', 'find', 'near',
]);

export interface LiveProfile {
  username: string;
  full_name: string;
  biography: string;
  category: string;
  followers: number;
  is_private: boolean;
  is_verified: boolean;
  profile_pic_url: string | null;
  score: number;
}

export interface LiveDiscoveryResult {
  tokens: string[];
  seeds: string[];
  results: LiveProfile[];
}

export interface LiveDiscoveryOptions {
  depth?: number;       // how many hops to expand outward (default 2)
  max?: number;         // stop after visiting this many profiles (default 40)
  delayMs?: number;     // throttle between profile fetches (default 350)
  budgetMs?: number;    // overall time budget so the request never hangs (default 25s)
}

export function tokenize(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
    ),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RawUser {
  username?: string;
  full_name?: string;
  biography?: string;
  category_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  profile_pic_url?: string;
  edge_followed_by?: { count?: number };
  edge_related_profiles?: { edges?: Array<{ node?: { username?: string } }> };
  edge_owner_to_timeline_media?: {
    edges?: Array<{
      node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } };
    }>;
  };
}

async function fetchProfile(username: string, budgetMs: number): Promise<RawUser | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(12_000, budgetMs));
  try {
    const res = await fetch(PROFILE_URL(username), {
      headers: REQUEST_HEADERS,
      signal: ctrl.signal,
    });
    if (!res.ok) return null; // 404 / 401 / 429 → skip this handle
    const json = (await res.json()) as { data?: { user?: RawUser } };
    return json?.data?.user ?? null;
  } catch {
    return null; // network error / abort / non-JSON login wall
  } finally {
    clearTimeout(timer);
  }
}

function summarize(user: RawUser, tokens: string[]): LiveProfile {
  const prof: Omit<LiveProfile, 'score'> = {
    username: user.username ?? '',
    full_name: user.full_name ?? '',
    biography: user.biography ?? '',
    category: user.category_name ?? '',
    followers: user.edge_followed_by?.count ?? 0,
    is_private: Boolean(user.is_private),
    is_verified: Boolean(user.is_verified),
    profile_pic_url: user.profile_pic_url ?? null,
  };
  return { ...prof, score: scoreProfile(prof, tokens) };
}

function scoreProfile(p: Omit<LiveProfile, 'score'>, tokens: string[]): number {
  const haystack = `${p.username} ${p.full_name} ${p.biography} ${p.category}`.toLowerCase();
  return tokens.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
}

function discoverLinks(user: RawUser): string[] {
  const found = new Set<string>();

  for (const edge of user.edge_related_profiles?.edges ?? []) {
    const u = edge.node?.username;
    if (u) found.add(u.toLowerCase());
  }

  for (const edge of user.edge_owner_to_timeline_media?.edges ?? []) {
    for (const c of edge.node?.edge_media_to_caption?.edges ?? []) {
      const text = c.node?.text ?? '';
      for (const m of text.matchAll(MENTION_RE)) {
        if (m[1]) found.add(m[1].toLowerCase());
      }
    }
  }

  return Array.from(found);
}

export async function liveDiscover(
  prompt: string,
  seeds: string[],
  options: LiveDiscoveryOptions = {},
): Promise<LiveDiscoveryResult> {
  const depth = options.depth ?? 2;
  const max = options.max ?? 40;
  const delayMs = options.delayMs ?? 350;
  const budgetMs = options.budgetMs ?? 25_000;
  const startedAt = Date.now();

  const tokens = tokenize(prompt);
  const cleanSeeds = seeds
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter((s) => /^[a-z0-9._]+$/.test(s));

  const visited = new Map<string, LiveProfile>();
  const seen = new Set<string>(cleanSeeds);
  const queue: Array<{ username: string; hop: number }> = cleanSeeds.map((s) => ({
    username: s,
    hop: 0,
  }));

  while (queue.length > 0 && visited.size < max) {
    if (Date.now() - startedAt > budgetMs) break;
    const { username, hop } = queue.shift()!;

    const user = await fetchProfile(username, budgetMs - (Date.now() - startedAt));
    await sleep(delayMs);
    if (!user || !user.username) continue;

    visited.set(username, summarize(user, tokens));

    if (hop < depth) {
      for (const next of discoverLinks(user)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push({ username: next, hop: hop + 1 });
        }
      }
    }
  }

  const results = Array.from(visited.values()).sort(
    (a, b) => b.score - a.score || b.followers - a.followers,
  );

  return { tokens, seeds: cleanSeeds, results };
}
