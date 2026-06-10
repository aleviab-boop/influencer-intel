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
  engagement: number; // engagement rate %, 0 if unknown
  creator_id?: string; // creators.id, once known (DB rows + persisted live rows)
  from?: 'db' | 'live';
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
      node?: {
        edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
        edge_liked_by?: { count?: number };
        edge_media_to_comment?: { count?: number };
      };
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

// ---- name → seed handles ------------------------------------------------
//
// Instagram's name search is login-walled, so we resolve a typed name (e.g.
// "mridul sharma") to real handles by generating plausible handle variations
// and probing each via web_profile_info. Hits become seeds for the crawl.

export interface NameMatch {
  handle: string;
  full_name: string;
  followers: number;
}

export function handleVariations(name: string): string[] {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const seps = ['', '_', '.'];
  const out = new Set<string>();
  for (const sep of seps) {
    const b = tokens.join(sep);
    for (const v of [
      b, `${b}_`, `_${b}`, `_${b}_`, `${b}official`, `${b}_official`,
      `its${b}`, `the${b}`, `real${b}`, `${b}1`, `${b}07`, `${b}s`, `${b}x`,
    ]) {
      if (/^[a-z0-9._]{2,30}$/.test(v)) out.add(v);
    }
  }
  return Array.from(out);
}

export async function resolveNameToSeeds(
  name: string,
  opts: { limit?: number; budgetMs?: number; delayMs?: number } = {},
): Promise<NameMatch[]> {
  const limit = opts.limit ?? 6;
  const budgetMs = opts.budgetMs ?? 14_000;
  const delayMs = opts.delayMs ?? 250;
  const startedAt = Date.now();

  const matches: NameMatch[] = [];
  for (const handle of handleVariations(name)) {
    if (matches.length >= limit) break;
    if (Date.now() - startedAt > budgetMs) break;
    const user = await fetchProfile(handle, budgetMs - (Date.now() - startedAt));
    await sleep(delayMs);
    if (user?.username) {
      matches.push({
        handle: user.username,
        full_name: user.full_name ?? '',
        followers: user.edge_followed_by?.count ?? 0,
      });
    }
  }
  return matches.sort((a, b) => b.followers - a.followers);
}

// ---- prompt → auto seed handles (no seed needed) ------------------------
//
// For a "city + niche" prompt like "food bloggers in indore" we generate
// plausible topic handles (indorefood, indorefoodie, indorefoodblogger, …)
// and probe them. City-niche accounts have very predictable handles, so this
// self-seeds the crawl with no login and no user-provided handle.

const KNOWN_CITIES = new Set([
  // metros + tier-1
  'mumbai', 'bombay', 'delhi', 'newdelhi', 'bangalore', 'bengaluru', 'hyderabad',
  'chennai', 'kolkata', 'calcutta', 'pune', 'ahmedabad', 'surat',
  // tier-2 / state capitals
  'jaipur', 'lucknow', 'kanpur', 'nagpur', 'indore', 'bhopal', 'patna',
  'vadodara', 'baroda', 'nashik', 'goa', 'agra', 'kochi', 'cochin', 'chandigarh',
  'amritsar', 'ludhiana', 'gurgaon', 'gurugram', 'noida', 'ghaziabad', 'faridabad',
  'visakhapatnam', 'vizag', 'coimbatore', 'madurai', 'mysore', 'mysuru', 'udaipur',
  'jodhpur', 'raipur', 'ranchi', 'guwahati', 'bhubaneswar', 'dehradun', 'shimla',
  'srinagar', 'jammu', 'varanasi', 'kanpur', 'allahabad', 'prayagraj', 'meerut',
  'jabalpur', 'gwalior', 'ujjain', 'aurangabad', 'rajkot', 'jamnagar', 'thane',
  'navimumbai', 'trivandrum', 'thiruvananthapuram', 'kozhikode', 'calicut',
  'mangalore', 'mangaluru', 'hubli', 'belgaum', 'vijayawada', 'guntur', 'warangal',
  'tirupati', 'salem', 'tiruchirappalli', 'trichy', 'pondicherry', 'siliguri',
  'jalandhar', 'patiala', 'bareilly', 'aligarh', 'moradabad', 'jhansi', 'kota',
  'ajmer', 'bikaner', 'dhanbad', 'jamshedpur', 'cuttack', 'amravati', 'solapur',
  'kolhapur', 'sangli', 'dombivli',
]);

const NICHE_SYNONYMS: Record<string, string[]> = {
  food: ['food', 'foodie', 'foodies', 'eats', 'foodgram', 'foodlover', 'khana'],
  fashion: ['fashion', 'style', 'fashionista', 'outfits', 'wardrobe', 'styling', 'ootd'],
  travel: ['travel', 'traveller', 'traveler', 'wanderlust', 'travelgram', 'trips', 'traveldiaries'],
  fitness: ['fitness', 'fit', 'gym', 'workout', 'fitlife', 'fitnessfreak', 'gymrat'],
  beauty: ['beauty', 'makeup', 'mua', 'glam', 'beautyblogger'],
  skincare: ['skincare', 'skin', 'glow', 'derma'],
  photography: ['photography', 'photos', 'clicks', 'photographer', 'lens', 'pixels', 'shots'],
  lifestyle: ['lifestyle', 'life', 'vibes', 'diaries', 'daily'],
  music: ['music', 'musician', 'singer', 'beats', 'sangeet', 'songs'],
  dance: ['dance', 'dancer', 'choreography', 'nritya', 'moves'],
  comedy: ['comedy', 'memes', 'funny', 'laughs', 'comedian', 'jokes'],
  art: ['art', 'artist', 'artwork', 'sketches', 'arts', 'kala', 'doodle'],
  cafe: ['cafe', 'cafes', 'coffee', 'cafehopping'],
  wedding: ['wedding', 'weddings', 'shaadi', 'bride', 'dulhan', 'weddingdiaries'],
  tech: ['tech', 'technology', 'gadgets', 'techie', 'gadget'],
  gaming: ['gaming', 'gamer', 'games', 'esports', 'gameplay'],
  education: ['education', 'study', 'learning', 'tutor', 'coaching', 'edu'],
  finance: ['finance', 'money', 'stocks', 'trading', 'investing', 'wealth', 'sharemarket'],
  pets: ['pets', 'dog', 'dogs', 'cats', 'petlover', 'doggo'],
  parenting: ['parenting', 'mom', 'mommy', 'momlife', 'kids', 'baby'],
  automobile: ['automobile', 'cars', 'auto', 'bikes', 'motovlog', 'carlover'],
  decor: ['decor', 'interior', 'home', 'homedecor', 'interiors'],
  books: ['books', 'bookstagram', 'reading', 'reads', 'bookworm'],
  realestate: ['realestate', 'property', 'realtor', 'homes'],
  sports: ['sports', 'cricket', 'football', 'athlete', 'sportsman'],
  beautyblogger: ['beauty', 'makeup', 'mua'],
};

// Words that act as handle suffixes rather than niche roots.
const SUFFIX_WORDS = new Set([
  'blogger', 'bloggers', 'blog', 'page', 'official', 'diaries', 'creator', 'creators',
]);

const HANDLE_SUFFIXES = [
  '', 's', 'official', 'blogger', 'bloggers', 'diaries', 'gram', 'hub', 'page',
  'life', 'vibes', 'world', 'club', 'wala', 'walla', 'guide',
];

function isNiche(token: string): boolean {
  return Boolean(NICHE_SYNONYMS[token] ?? NICHE_SYNONYMS[token.replace(/s$/, '')]);
}

export function topicHandleCandidates(prompt: string): string[] {
  const toks = tokenize(prompt).filter((t) => !SUFFIX_WORDS.has(t));
  if (toks.length === 0) return [];

  const cityTokens = toks.filter((t) => KNOWN_CITIES.has(t));
  const nicheTokens = toks.filter((t) => isNiche(t));
  // Tokens that are neither a known city nor a known niche → likely an
  // unlisted place name (so "vizag food" still works even if vizag is new).
  const otherTokens = toks.filter((t) => !KNOWN_CITIES.has(t) && !isNiche(t));

  const locations = cityTokens.length > 0 ? cityTokens : otherTokens;

  const niches = new Set<string>();
  for (const n of nicheTokens) {
    const syns = NICHE_SYNONYMS[n] ?? NICHE_SYNONYMS[n.replace(/s$/, '')] ?? [n];
    for (const s of syns) niches.add(s);
  }
  // No recognized niche → fall back to the leftover words as the niche.
  if (niches.size === 0) for (const t of (nicheTokens.length ? nicheTokens : otherTokens)) niches.add(t);

  const locList = locations.length > 0 ? locations : [''];
  const out = new Set<string>();
  for (const loc of locList) {
    for (const nv of niches) {
      if (loc === nv) continue; // avoid "food" being both location and niche
      for (const sep of ['', '_']) {
        const bases = loc ? [[loc, nv].join(sep), [nv, loc].join(sep)] : [nv];
        for (const base of bases) {
          for (const suf of HANDLE_SUFFIXES) {
            const h = suf ? `${base}${sep}${suf}` : base;
            if (/^[a-z0-9._]{3,30}$/.test(h)) out.add(h);
          }
        }
      }
    }
  }
  return Array.from(out);
}

export async function resolveTopicToSeeds(
  prompt: string,
  opts: { limit?: number; budgetMs?: number; delayMs?: number; maxProbes?: number } = {},
): Promise<NameMatch[]> {
  const limit = opts.limit ?? 8;
  const budgetMs = opts.budgetMs ?? 16_000;
  const delayMs = opts.delayMs ?? 220;
  const maxProbes = opts.maxProbes ?? 60;
  const startedAt = Date.now();

  const matches: NameMatch[] = [];
  let probed = 0;
  for (const handle of topicHandleCandidates(prompt)) {
    if (matches.length >= limit || probed >= maxProbes) break;
    if (Date.now() - startedAt > budgetMs) break;
    probed++;
    const user = await fetchProfile(handle, budgetMs - (Date.now() - startedAt));
    await sleep(delayMs);
    if (user?.username) {
      matches.push({
        handle: user.username,
        full_name: user.full_name ?? '',
        followers: user.edge_followed_by?.count ?? 0,
      });
    }
  }
  return matches.sort((a, b) => b.followers - a.followers);
}

function summarize(user: RawUser, tokens: string[]): LiveProfile {
  const followers = user.edge_followed_by?.count ?? 0;
  const prof: Omit<LiveProfile, 'score'> = {
    username: user.username ?? '',
    full_name: user.full_name ?? '',
    biography: user.biography ?? '',
    category: user.category_name ?? '',
    followers,
    is_private: Boolean(user.is_private),
    is_verified: Boolean(user.is_verified),
    profile_pic_url: user.profile_pic_url ?? null,
    engagement: engagementRate(user, followers),
  };
  return { ...prof, score: scoreProfile(prof, tokens) };
}

// Engagement rate % from recent posts: average (likes + comments) per post,
// divided by followers. 0 when there's no usable post/follower data.
function engagementRate(user: RawUser, followers: number): number {
  if (followers <= 0) return 0;
  const edges = user.edge_owner_to_timeline_media?.edges ?? [];
  let total = 0;
  let counted = 0;
  for (const e of edges) {
    const likes = e.node?.edge_liked_by?.count ?? 0;
    const comments = e.node?.edge_media_to_comment?.count ?? 0;
    if (likes > 0 || comments > 0) {
      total += likes + comments;
      counted++;
    }
  }
  if (counted === 0) return 0;
  return Math.round((total / counted / followers) * 1000) / 10; // 1 decimal %
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
