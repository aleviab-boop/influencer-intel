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

import { igFetch } from './ig-fetch';
import { apifyHashtag, apifyProfileOrNull, apifyProfilesBatch } from './apify';
import type { ScrapedProfile } from './instagram-scraper';

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
  email?: string | null;
  phone?: string | null;
  link?: string | null;
  creator_id?: string; // creators.id, once known (DB rows + persisted live rows)
  from?: 'db' | 'live';
  loc_match?: boolean; // matched a place token in the location field (DB search)
  niche_match?: boolean; // profile text shows evidence of the search's SUBJECT/niche
  curated?: boolean; // from the user's own curated/imported list (source='manual')
  gender?: 'female' | 'male' | 'unknown' | null; // creator's inferred gender
  unverified?: boolean; // AI-suggested but not yet confirmed on IG (cookie down)
  from_ai?: boolean; // surfaced by the OpenAI web-search suggester
  completeness?: number; // 0–10 data-completeness score (how many fields we hold)
  is_indian?: boolean; // false = known-foreign (sinks in ranking); India-only platform
}

// Data-completeness score (0–10): how much of a creator's profile we actually
// hold, NOT how relevant/good they are. A fully-enriched row (followers, ER,
// bio, name, category, photo, contact) scores 10; each missing field knocks it
// down, so an un-enriched stub (just a handle) sits near 0. The two real metrics
// an agency ranks on — reach and engagement — are weighted double. We still
// STORE every creator regardless of score; this just surfaces how complete they
// are so partial rows are visible-but-flagged rather than hidden.
export function completenessScore(p: {
  full_name?: string | null;
  biography?: string | null;
  category?: string | null;
  profile_pic_url?: string | null;
  followers?: number | null;
  engagement?: number | null;
  email?: string | null;
  phone?: string | null;
  link?: string | null;
}): number {
  let s = 0;
  if ((p.followers ?? 0) > 0) s += 2;              // reach — key metric
  if ((p.engagement ?? 0) > 0) s += 2;             // engagement — key metric
  if (p.biography && p.biography.trim()) s += 2;   // bio
  if (p.category && p.category.trim()) s += 1;     // niche/category
  if (p.full_name && p.full_name.trim()) s += 1;   // display name
  if (p.profile_pic_url) s += 1;                   // avatar
  if (p.email || p.phone || p.link) s += 1;        // reachable contact
  return s; // 0..10
}

export interface LiveDiscoveryResult {
  tokens: string[];
  seeds: string[];
  results: LiveProfile[];
}

export interface LiveDiscoveryOptions {
  depth?: number;          // how many hops to expand outward (default 2)
  max?: number;            // stop after visiting this many profiles (default 40)
  delayMs?: number;        // throttle between profile fetches (default 350)
  budgetMs?: number;       // overall time budget so the request never hangs (default 25s)
  seedConcurrency?: number; // how many seed profiles to enrich in parallel (default 12)
  apifyDirect?: boolean;    // campaign mode: skip the free cookie stage and enrich
                            // seeds straight from Apify. Normal mode (false) tries
                            // the free/relay path first and only falls to Apify on
                            // break — "my scraper first, Apify when it breaks".
  expansionApifyCap?: number; // max graph-expansion nodes allowed to fall through
                              // to paid Apify when the free crawl is throttled
                              // (default 6). Only spent on 401/403/429; a healthy
                              // pool never pays. 0 disables expansion-stage Apify.
}

// Words that frame an age/count constraint but aren't searchable themselves —
// e.g. "genz creator in delhi age 18-23". Their numbers (18, 23) would otherwise
// match any handle/bio containing those digits (jazzkaur18, vidhi1923, …) and
// flood the results with noise, so we drop age words AND bare numbers entirely.
const AGE_NOISE = new Set(['age', 'aged', 'ages', 'year', 'years', 'yr', 'yrs', 'yo', 'old']);

export function tokenize(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !AGE_NOISE.has(t) && !/^\d+$/.test(t)),
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
  external_url?: string | null;
  business_email?: string | null;
  public_email?: string | null;
  edge_followed_by?: { count?: number };
  edge_related_profiles?: { edges?: Array<{ node?: { username?: string } }> };
  edge_owner_to_timeline_media?: {
    edges?: Array<{
      node?: {
        shortcode?: string;
        edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
        edge_liked_by?: { count?: number };
        edge_media_to_comment?: { count?: number };
      };
    }>;
  };
}

// Map an Apify ScrapedProfile onto the web_profile_info RawUser shape so a
// paid-fallback enrichment is a drop-in for the free one — same scoring, same
// engagement math, same contact extraction downstream. The Apify profile actor
// has no "related profiles" graph, so edge_related_profiles is empty: an
// Apify-enriched seed still yields full data (followers/bio/posts) but can't be
// crawled outward. That's fine — outward crawl needs a live cookie anyway.
// Map Apify's ScrapedProfile onto the web_profile_info RawUser shape the whole
// pipeline (summarize / discoverLinks / scoring) already speaks, so an Apify-
// enriched seed is a drop-in for a cookie-enriched one. Apify gives no related-
// profiles graph, so graph expansion off an Apify seed is empty (expected).
function scrapedToRawUser(p: ScrapedProfile): RawUser {
  return {
    username: p.handle,
    full_name: p.display_name ?? undefined,
    biography: p.biography ?? undefined,
    category_name: p.category ?? undefined,
    is_private: false,
    is_verified: p.is_verified,
    profile_pic_url: p.profile_photo_url ?? undefined,
    external_url: p.external_url,
    business_email: null,
    public_email: null,
    edge_followed_by: { count: p.follower_count },
    edge_related_profiles: { edges: [] },
    edge_owner_to_timeline_media: {
      edges: p.recent_posts.map((post) => ({
        node: {
          shortcode: post.platform_post_id,
          edge_media_to_caption: { edges: post.caption ? [{ node: { text: post.caption } }] : [] },
          edge_liked_by: { count: post.like_count },
          edge_media_to_comment: { count: post.comment_count },
        },
      })),
    },
  };
}

async function apifyProfileAsRawUser(username: string, timeoutMs = 15_000): Promise<RawUser | null> {
  // Cap each paid enrichment so a slow Apify run can't blow the request's
  // maxDuration when many run in parallel. The underlying run may still finish
  // (and bill) in the background; we just stop waiting on it past the cap.
  const p = await Promise.race([
    apifyProfileOrNull(username), // null if APIFY_TOKEN unset or run failed
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!p?.handle) return null;
  return scrapedToRawUser(p);
}

// Enrich MANY handles through ONE Apify run (the profile scraper batches an array
// of usernames). This is what makes a dead-cookie campaign page fill: a single
// billed run returns the whole seed set, versus per-profile runs that each cost a
// 20–60s cold-start and so only surfaced ~1 result before the budget expired.
// Returns handle→RawUser for whatever resolved. No-op (empty) without APIFY_TOKEN.
async function apifyProfilesAsRawUsers(
  usernames: string[],
  timeoutMs = 100_000,
): Promise<Map<string, RawUser>> {
  const out = new Map<string, RawUser>();
  if (usernames.length === 0) return out;
  const batch = await Promise.race([
    apifyProfilesBatch(usernames),
    new Promise<Map<string, ScrapedProfile>>((resolve) =>
      setTimeout(() => resolve(new Map()), timeoutMs),
    ),
  ]);
  for (const [h, p] of batch) out.set(h, scrapedToRawUser(p));
  return out;
}

// Fetch a profile from Instagram's free endpoint. `allowApify` opts THIS call
// into the PAID Apify fallback when the free path is blocked (401/403/429) — set
// only for the profiles we actually display (seed enrichment), never for the
// wider graph crawl, so a dead cookie still yields enriched results without
// fanning Apify calls across every probed handle. A genuine 404 / empty-200
// (handle doesn't exist) never triggers Apify — we don't pay to disprove a
// hallucination. No-op unless APIFY_TOKEN is set, so free-only users are unchanged.
async function fetchProfile(
  username: string,
  budgetMs: number,
  allowApify = false,
): Promise<RawUser | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(12_000, budgetMs));
  try {
    const res = await igFetch(PROFILE_URL(username), {
      headers: REQUEST_HEADERS,
      signal: ctrl.signal,
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { user?: RawUser } };
      return json?.data?.user ?? null; // 200 with no user = doesn't exist → no Apify
    }
    if (allowApify && (res.status === 401 || res.status === 403 || res.status === 429)) {
      return await apifyProfileAsRawUser(username); // free path blocked → paid net
    }
    return null; // 404 / other → skip this handle
  } catch {
    // igFetch THREW: the relay/tunnel is unreachable (laptop off) or the request
    // aborted/timed out. That's the "free path is blocked" case the paid net was
    // built for — the fallback would be dead weight if it only fired on a live
    // relay's 401. A genuine 404 / empty-200 is a *returned* status (handled
    // above), never a throw, so we still never pay to disprove a hallucination.
    if (allowApify) return await apifyProfileAsRawUser(username);
    return null; // graph-expansion crawl: free-only, skip on error
  } finally {
    clearTimeout(timer);
  }
}

// Fetch many profiles with BOUNDED CONCURRENCY. This is the throughput fix for
// the Apify enrichment path: enriching seeds one-at-a-time meant a dead-cookie
// campaign search only surfaced ~1 creator before the time budget ran out (each
// paid profile call takes a few seconds). Running a pool of them at once fills a
// full page in the same window. Free (cookie-alive) fetches parallelize too, but
// concurrency is capped to stay polite to Instagram. Returns handle→RawUser for
// whatever resolved before the shared budget expired.
async function fetchProfilesConcurrent(
  usernames: string[],
  budgetMs: number,
  allowApify: boolean,
  concurrency: number,
): Promise<Map<string, RawUser>> {
  const out = new Map<string, RawUser>();
  const startedAt = Date.now();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < usernames.length) {
      if (Date.now() - startedAt > budgetMs) return; // out of time → stop dispatching
      const u = usernames[cursor++]!;
      const user = await fetchProfile(u, budgetMs - (Date.now() - startedAt), allowApify);
      if (user?.username) out.set(u, user);
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, usernames.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return out;
}

// Like fetchProfile but also reports the HTTP status, so callers can tell a
// genuine 404 (handle doesn't exist) apart from a 401/429/timeout (couldn't
// verify because the session is throttled/down). status 200 with a null user
// also means "doesn't exist"; status 0 means network/abort.
async function fetchProfileWithStatus(
  username: string,
  budgetMs: number,
): Promise<{ user: RawUser | null; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(12_000, budgetMs));
  try {
    const res = await igFetch(PROFILE_URL(username), { headers: REQUEST_HEADERS, signal: ctrl.signal });
    if (!res.ok) return { user: null, status: res.status };
    const json = (await res.json()) as { data?: { user?: RawUser } };
    return { user: json?.data?.user ?? null, status: 200 };
  } catch {
    return { user: null, status: 0 };
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
  collab_signal?: boolean; // caption showed brand-collab evidence (proven collaborator)
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

export const KNOWN_CITIES = new Set([
  // metros + tier-1
  'mumbai', 'bombay', 'delhi', 'newdelhi', 'bangalore', 'bengaluru', 'hyderabad',
  'chennai', 'kolkata', 'calcutta', 'pune', 'ahmedabad', 'surat',
  // tier-2 / state capitals
  'jaipur', 'lucknow', 'kanpur', 'nagpur', 'indore', 'bhopal', 'patna',
  'vadodara', 'baroda', 'nashik', 'goa', 'agra', 'kochi', 'cochin', 'chandigarh',
  'amritsar', 'ludhiana', 'gurgaon', 'gurugram', 'noida', 'ghaziabad', 'faridabad',
  'visakhapatnam', 'vizag', 'coimbatore', 'madurai', 'mysore', 'mysuru', 'udaipur',
  'jodhpur', 'raipur', 'ranchi', 'guwahati', 'dibrugarh', 'silchar', 'jorhat',
  'tezpur', 'nagaon', 'bhubaneswar', 'dehradun', 'shimla',
  'srinagar', 'jammu', 'varanasi', 'kanpur', 'allahabad', 'prayagraj', 'meerut',
  'jabalpur', 'gwalior', 'ujjain', 'aurangabad', 'rajkot', 'jamnagar', 'thane',
  'navimumbai', 'trivandrum', 'thiruvananthapuram', 'kozhikode', 'calicut',
  'mangalore', 'mangaluru', 'hubli', 'belgaum', 'vijayawada', 'guntur', 'warangal',
  'tirupati', 'salem', 'tiruchirappalli', 'trichy', 'pondicherry', 'siliguri',
  'jalandhar', 'patiala', 'bareilly', 'aligarh', 'moradabad', 'jhansi', 'kota',
  'ajmer', 'bikaner', 'dhanbad', 'jamshedpur', 'cuttack', 'amravati', 'solapur',
  'kolhapur', 'sangli', 'dombivli',
]);

// Indian STATES → their notable cities. A search like "tech creator in gujarat"
// names a state, not a city, so on its own it matches nothing in the (city-level)
// location field. We expand a state into its cities so the location ranking
// applies to creators anywhere in that state.
export const STATE_CITIES: Record<string, string[]> = {
  gujarat: ['ahmedabad', 'surat', 'vadodara', 'baroda', 'rajkot', 'gandhinagar', 'jamnagar', 'bhavnagar'],
  maharashtra: ['mumbai', 'pune', 'nagpur', 'nashik', 'thane', 'aurangabad', 'solapur', 'kolhapur'],
  karnataka: ['bangalore', 'bengaluru', 'mysore', 'mysuru', 'mangalore', 'mangaluru', 'hubli', 'belgaum'],
  kerala: ['kochi', 'cochin', 'trivandrum', 'thiruvananthapuram', 'kozhikode', 'calicut', 'thrissur'],
  telangana: ['hyderabad', 'warangal'],
  rajasthan: ['jaipur', 'jodhpur', 'udaipur', 'kota', 'ajmer', 'bikaner'],
  punjab: ['chandigarh', 'ludhiana', 'amritsar', 'jalandhar', 'patiala'],
  goa: ['goa', 'panaji'],
  bihar: ['patna'],
  odisha: ['bhubaneswar', 'cuttack'],
  assam: ['guwahati', 'dibrugarh', 'silchar', 'jorhat', 'tezpur', 'nagaon'],
  jharkhand: ['ranchi', 'jamshedpur', 'dhanbad'],
  chhattisgarh: ['raipur'],
  haryana: ['gurgaon', 'gurugram', 'faridabad'],
  uttarakhand: ['dehradun'],
};

// Expand any STATE token in the list into its cities (keeping the state token),
// deduped. A no-op when the query has no state. Used by DB search so state-level
// searches rank creators in that state's cities.
export function expandStateTokens(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) {
    const cities = STATE_CITIES[t.toLowerCase()];
    if (cities) for (const c of cities) out.add(c);
  }
  return Array.from(out);
}

// A token is a "location" (excluded from the niche gate) if it's a city OR a state.
export function isLocationToken(t: string): boolean {
  const l = t.toLowerCase();
  return KNOWN_CITIES.has(l) || l in STATE_CITIES;
}

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
  // Product/apparel words — a campaign brief names the PRODUCT ("denim campaign",
  // "saree shoot"), not the niche. Map each to CREATOR-oriented tags so discovery
  // searches where people post looks (#denimstyle/#ootd), not the bare product tag
  // (#denim = shops/resellers). Extend this list as new product verticals come up.
  denim: ['denim', 'denimstyle', 'denimfashion', 'ootd', 'jeans'],
  jeans: ['jeans', 'denim', 'denimstyle', 'ootd'],
  saree: ['saree', 'sareelove', 'sareefashion', 'sareedraping', 'ethnicwear'],
  ethnic: ['ethnicwear', 'indianwear', 'traditionalwear', 'kurta', 'ethnic'],
  sneakers: ['sneakers', 'sneakerhead', 'streetstyle', 'sneakercommunity', 'shoes'],
  streetwear: ['streetwear', 'streetstyle', 'ootd', 'fashion'],
  jewellery: ['jewellery', 'jewelry', 'jewellerylove', 'accessories', 'earrings'],
  watch: ['watch', 'watches', 'wristwatch', 'watchesofinstagram', 'horology'],
  // Festival / cultural-event campaigns — the "campaign" is a THEME, so relevance
  // is topical (who makes this content), not brand-collab. Expand to the event's
  // real hashtags incl. regional spellings so we find people who post it.
  puja: ['puja', 'pujo', 'durgapuja', 'durgapujo', 'pandalhopping', 'pujovibes', 'festive', 'ethnicwear'],
  // "pujo" (Bengali) and the event hashtags are UNAMBIGUOUS festival words — a
  // lone "pujo"/"durgapuja" means the festival, never a person's name — so they're
  // their own niche keys (isNiche → true) and each maps to the festival's real
  // hashtags. This is what makes "pujo creators" or "durga puja campaign" classify
  // as a festival brief and pull festive-fashion/lifestyle creators, not people
  // literally named "Puja". (Bare "puja"/"durga" stay AMBIGUOUS — see below.)
  pujo: ['pujo', 'puja', 'durgapuja', 'durgapujo', 'pandalhopping', 'pujovibes', 'festive', 'ethnicwear'],
  durgapuja: ['durgapuja', 'durgapujo', 'pujo', 'pandalhopping', 'pujovibes', 'festive', 'ethnicwear'],
  durgapujo: ['durgapujo', 'durgapuja', 'pujo', 'pandalhopping', 'pujovibes', 'festive', 'ethnicwear'],
  festival: ['festival', 'festive', 'festivevibes', 'tyohaar', 'celebration', 'ethnicwear'],
  diwali: ['diwali', 'deepavali', 'festivevibes', 'diwalivibes', 'festive', 'ethnicwear'],
  navratri: ['navratri', 'navaratri', 'garba', 'dandiya', 'navratrivibes', 'festive', 'ethnicwear'],
  onam: ['onam', 'onamcelebration', 'onam2026', 'festive', 'kerala'],
};

// Words that act as handle suffixes rather than niche roots.
const SUFFIX_WORDS = new Set([
  'blogger', 'bloggers', 'blog', 'page', 'official', 'diaries', 'creator', 'creators',
]);

// Campaign-brief jargon that frames INTENT but isn't a searchable subject —
// "influencers for a denim CAMPAIGN", "BRAND DEAL", "PROMO", "COLLAB". Left in,
// these produce junk hashtags (#campaignfashion) and pollute the niche gate. We
// strip them so the real niche/city drives discovery. Generic across categories.
const CAMPAIGN_FILLER = new Set([
  'campaign', 'campaigns', 'brand', 'brands', 'branded', 'deal', 'deals',
  'promo', 'promos', 'promotion', 'promotions', 'launch', 'launches',
  'collab', 'collabs', 'collaboration', 'collaborations', 'sponsored',
  'sponsorship', 'ad', 'ads', 'paid', 'partnership', 'partnerships',
]);

// A "campaign" / brand-brief prompt is a DISCOVERY-intent search — the user wants
// FRESH creators for a brief, not a specific known account. For these we skip the
// free handle-guessing step (slow, and it can return junk handles that block the
// far-better hashtag path) and go straight to Apify hashtag discovery with wider
// coverage. Detects the campaign/collab vocabulary an agency actually types.
const CAMPAIGN_INTENT =
  /\b(campaign|campaigns|collab|collabs|collaboration|promotion|promo|shoot|endorsement|barter)\b/i;
export function isCampaignPrompt(prompt: string): boolean {
  return CAMPAIGN_INTENT.test(prompt);
}

// Canonical identity for a campaign brief: the meaningful SUBJECT tokens, with
// filler stripped (stopwords like "influencers"/"creators"/"for" drop in
// tokenize; campaign jargon and suffix words drop here) and sorted so word order
// doesn't matter. So "influencers for durga puja campaign" and "creators for
// durga puja campaign" both reduce to "durga puja" — the SAME search. The API
// uses this to serve the same cached DB results on a repeat instead of
// re-scraping every time. Empty string when a prompt has no subject words.
export function campaignKey(prompt: string): string {
  return tokenize(prompt)
    .filter((t) => !CAMPAIGN_FILLER.has(t) && !SUFFIX_WORDS.has(t))
    .sort()
    .join(' ');
}

// Generic brand-collaboration signal — the PUBLIC fingerprint a creator leaves
// when they've done paid brand work, identical across every niche (no per-brand
// list needed). Instagram/ASCI disclosure rules mean real collabs carry one of
// these markers; a bare "#ad" counts because \b matches across the '#'.
const COLLAB_MARKERS =
  /\b(ad|ads|sponsored|sponsorship|collab|collaboration|partner(?:ed|ship)?|paidpartnership|brandambassador|ambassador|gifted|associationwith|poweredby)\b/i;

// Score a post caption for brand-collab evidence, generically:
//   2 → disclosure marker AND an @brand mention (disclosed + tagged) → strongest
//   1 → disclosure marker only
//   0 → no collab signal (plain niche content)
// Used to float PROVEN collaborators to the front of the crawl queue so, under a
// limited crawl budget, the creators who actually do brand deals get enriched
// and surfaced first — for ANY "influencers for <x> campaign" search.
export function collabScore(caption: string | null | undefined): number {
  if (!caption) return 0;
  const hasMarker = COLLAB_MARKERS.test(caption);
  if (!hasMarker) return 0;
  const hasBrandMention = /@[a-z0-9._]{2,}/i.test(caption);
  return hasBrandMention ? 2 : 1;
}

const HANDLE_SUFFIXES = [
  '', 's', 'official', 'blogger', 'bloggers', 'diaries', 'gram', 'hub', 'page',
  'life', 'vibes', 'world', 'club', 'wala', 'walla', 'guide',
];

function isNiche(token: string): boolean {
  return Boolean(NICHE_SYNONYMS[token] ?? NICHE_SYNONYMS[token.replace(/s$/, '')]);
}

// The SUBJECT words a prompt targets — the searchable niche/topic tokens with
// location names, filler suffixes ("creator", "blogger") and stopwords stripped,
// then expanded with known niche synonyms. This is what a result must show
// evidence of to count as ON-TOPIC. For "vintage watch collector in mumbai" it
// yields [vintage, watch, collector] (mumbai dropped as location) — so a Mumbai
// news/politics mega-account, which matches the LOCATION but none of the subject
// words, can be filtered out. Returns [] when the prompt has no subject words
// (e.g. a bare "@handle" or "creators in delhi"), in which case there's no gate.
export function nicheKeywords(prompt: string): string[] {
  const toks = tokenize(prompt).filter(
    (t) => !isLocationToken(t) && !SUFFIX_WORDS.has(t) && !CAMPAIGN_FILLER.has(t),
  );
  const out = new Set<string>();
  for (const t of toks) {
    if (t.length > 2) out.add(t);
    const stem = t.replace(/s$/, '');
    if (stem.length > 2) out.add(stem);
    const syns = NICHE_SYNONYMS[t] ?? NICHE_SYNONYMS[stem];
    if (syns) for (const s of syns) out.add(s);
  }
  return Array.from(out);
}

// Some subject words are ALSO common Indian personal names / deity names
// ("Durga", "Puja", "Kali", "Lakshmi"…). A festival brief ("durga puja campaign")
// expands to these tokens, but on their own they match every person NAMED that:
// "Puja Sharma" the food blogger, or a shop called "Durga Fashion" — none of whom
// make festival content. So these tokens are AMBIGUOUS: they only count as real
// subject evidence when they CO-OCCUR (both "durga" AND "puja" → the festival) or
// alongside an unambiguous festival token. The specific event hashtags
// (durgapuja, pujovibes, pandalhopping…) are NOT ambiguous and pass on their own.
const AMBIGUOUS_SUBJECT_TOKENS = new Set([
  'durga', 'puja', 'kali', 'laxmi', 'lakshmi', 'radha', 'ganesh', 'ganesha',
  'saraswati', 'shiva', 'krishna', 'ram', 'rama',
]);

// Does a profile's combined text (handle + name + bio + category) show evidence
// of the search's subject? Word-boundary match on the niche keywords, with one
// refinement: an AMBIGUOUS token (a common name that doubles as a subject word)
// only counts when it co-occurs with other evidence — a single "puja"/"durga"
// hit is a PERSON, not proof of festival content. An empty keyword list means
// "no gate" → always true. Tokens are alphanumeric, so no regex escaping needed.
export function hasNicheEvidence(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const t = text.toLowerCase();
  const hit = (k: string) => new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`).test(t);

  let strong = false; // an unambiguous subject token matched
  let ambiguous = 0; // count of ambiguous (common-name) tokens matched
  for (const k of keywords) {
    if (!hit(k)) continue;
    if (AMBIGUOUS_SUBJECT_TOKENS.has(k)) ambiguous++;
    else strong = true;
  }
  // Unambiguous evidence is enough on its own. Ambiguous name-tokens need to
  // co-occur (≥2, e.g. "Durga" + "Puja" = the festival) to count — otherwise a
  // lone "Puja"/"Durga" in a personal name would wrongly pass the gate.
  return strong || ambiguous >= 2;
}

// Business / brand / shop accounts vs individual CREATORS. A brand searching for a
// fashion "influencer" wants PEOPLE, but the DB was seeded/scraped with apparel
// labels, boutiques and saree stores that got tagged "fashion" (Pakeeza Collection,
// JS Garments Bridal Wear, Happy Moments | Ethnic Wear, ABSTRACT MENS). Those are
// shops, not creators, and pad the results with non-influencers. This flags them so
// the discovery page can drop/demote them. Deliberately CONSERVATIVE — matches only
// strong retail vocabulary in the handle/name, or an explicit shopping/retail
// category — so a real creator (whose bio merely says "fashion") is never misflagged.
const BUSINESS_WORDS = [
  'collection', 'collections', 'garment', 'garments', 'apparel', 'couture',
  'boutique', 'clothing', 'textile', 'textiles', 'emporium', 'bazaar', 'wholesale',
  'export', 'exports', 'jeweller', 'jewellers', 'readymade', 'manufacturer',
  'enterprise', 'enterprises', 'fashions',
];
const BUSINESS_NAME_WORDS = /\b(wear|store|mart|shoppe)\b/;
const BUSINESS_CATEGORY = /(shopping|retail|wholesale|apparel|clothing|boutique|manufacturer|e-?commerce|brand store)/;
export function looksLikeBusinessAccount(handle: string, name: string, category: string): boolean {
  const cat = (category || '').toLowerCase();
  if (BUSINESS_CATEGORY.test(cat)) return true;
  const nm = ` ${(name || '').toLowerCase()} `;
  if (BUSINESS_NAME_WORDS.test(nm)) return true;
  const h = (handle || '').toLowerCase();
  const idText = ` ${`${h} ${name}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (const w of BUSINESS_WORDS) {
    if (idText.includes(` ${w} `) || h.includes(w)) return true;
  }
  return false;
}

// Split a prompt into a region (known city), a niche (recognised category),
// and the full token list — used to tag saved creators so they're findable.
export function classifyPrompt(prompt: string): { region: string | null; niche: string | null; tags: string[] } {
  const toks = tokenize(prompt);
  const region = toks.find((t) => KNOWN_CITIES.has(t)) ?? null;
  const niche = toks.find((t) => isNiche(t)) ?? toks.find((t) => t !== region) ?? null;
  return { region, niche, tags: toks };
}

// Infer the dominant niche across a set of crawled profiles by scanning their
// category + bio for niche keywords. Lets a seed-only search (e.g. one fashion
// creator) tag its whole network as "fashion" even when the prompt has no niche.
export function inferNiche(profiles: Array<{ category?: string; biography?: string }>): string | null {
  const counts = new Map<string, number>();
  for (const p of profiles) {
    const text = `${p.category ?? ''} ${p.biography ?? ''}`.toLowerCase();
    for (const [root, syns] of Object.entries(NICHE_SYNONYMS)) {
      if (root === 'beautyblogger') continue; // alias, skip
      if (text.includes(root) || syns.some((s) => text.includes(s))) {
        counts.set(root, (counts.get(root) ?? 0) + 1);
      }
    }
  }
  let best: string | null = null;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) { max = v; best = k; }
  }
  return best;
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

  // NOTE: Instagram blocks its search + hashtag endpoints for a plain
  // (non-browser) request even WITH a valid cookie (401 / redirect-to-login) —
  // only web_profile_info is reachable. So the instant platform-side seed
  // resolution can only PROBE guessed "<city><niche>" handles; genuine
  // search-based discovery for an arbitrary niche+city has to run on the worker
  // (full browser session), which the cold-search flow already queues.
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

// ---- prompt → hashtag seeds (PAID Apify fallback) -----------------------
//
// resolveTopicToSeeds can only PROBE guessed "<city><niche>" handles for free —
// on cold prompts where no guessed handle exists it comes back empty. Instagram's
// real hashtag search IS login-walled to us, but the Apify hashtag scraper can
// reach it. So when the free path finds no seeds, we search the topic hashtag and
// take the top handles posting under it as REAL crawl seeds.

// The best hashtag(s) for a prompt: prefer a specific "<city><niche>" tag, then
// the niche alone, then the city. Alphanumeric, 3+ chars (valid IG hashtags).
export function hashtagCandidates(prompt: string): string[] {
  const toks = tokenize(prompt).filter((t) => !SUFFIX_WORDS.has(t) && !CAMPAIGN_FILLER.has(t));
  if (toks.length === 0) return [];
  const cities = toks.filter((t) => KNOWN_CITIES.has(t));
  const niches = toks.filter((t) => isNiche(t));
  const others = toks.filter((t) => !KNOWN_CITIES.has(t) && !isNiche(t));
  const locs = cities.length ? cities : others;

  // Build the SUBJECT hashtags. For a recognized niche/product word, EXPAND it
  // into its creator-oriented synonym tags (denim → denimstyle, ootd, fashion) so
  // we search where creators post looks, not the bare product tag. Unrecognized
  // subject words (e.g. "durgapuja") fall through as-is — they're still valid
  // event/topic hashtags that surface people who post that content.
  const subjectTokens = niches.length ? niches : others;
  const subs: string[] = [];
  const pushUniq = (h: string) => { if (h && !subs.includes(h)) subs.push(h); };
  for (const t of subjectTokens) {
    pushUniq(t);
    const syns = NICHE_SYNONYMS[t] ?? NICHE_SYNONYMS[t.replace(/s$/, '')];
    if (syns) for (const s of syns) pushUniq(s);
  }
  if (subs.length === 0) for (const t of others) pushUniq(t);

  const hasCity = cities.length > 0;
  const out: string[] = [];
  for (const loc of locs) for (const n of subs) if (loc !== n) out.push(`${loc}${n}`);
  // India bias — the platform serves India ONLY. When the prompt names no city,
  // interleave India-localized variants (#indiandenim) with each bare subject tag
  // so discovery leans toward Indian creators and fewer foreign seeds get fetched
  // (and then wasted by the downstream India filter). A named city already
  // localizes, so we skip the bias there.
  for (const n of subs) {
    out.push(n);
    if (!hasCity) out.push(`indian${n}`);
  }
  for (const loc of locs) out.push(loc);
  return Array.from(new Set(out.filter((h) => /^[a-z0-9]{3,}$/.test(h))));
}

// Search the top hashtag for a prompt via Apify and return the handles posting
// under it as crawl seeds (deduped, most-followed first). No-op — returns [] —
// when APIFY_TOKEN is unset or no hashtag can be derived, so it's free-safe.
export async function resolveHashtagToSeeds(
  prompt: string,
  opts: { limit?: number; postsPerTag?: number; tags?: number } = {},
): Promise<NameMatch[]> {
  const limit = opts.limit ?? 10;
  const cands = hashtagCandidates(prompt);
  if (cands.length === 0) return [];
  const tagCount = Math.min(opts.tags ?? 2, cands.length);
  const perTag = opts.postsPerTag ?? 30;

  // Search the top few candidate hashtags in parallel and merge their posters —
  // more seeds, and robust to a thin top hashtag. Each apifyHashtag no-ops to []
  // without APIFY_TOKEN, so this stays free-safe.
  const batches = await Promise.all(
    cands.slice(0, tagCount).map((c) => apifyHashtag(c, perTag).catch(() => [])),
  );

  // Merge by handle, keeping the strongest collab signal + any known follower
  // count seen across the hashtags a creator appeared under.
  const merged = new Map<string, { followers: number; collab: number }>();
  for (const hits of batches) {
    for (const h of hits) {
      const handle = h.handle.trim().toLowerCase();
      if (!handle) continue;
      const collab = collabScore(h.caption);
      const prev = merged.get(handle);
      if (prev) {
        prev.collab = Math.max(prev.collab, collab);
        if (!prev.followers && h.followers) prev.followers = h.followers;
      } else {
        merged.set(handle, { followers: h.followers ?? 0, collab });
      }
    }
  }

  const matches: NameMatch[] = Array.from(merged, ([handle, v]) => ({
    handle,
    full_name: '',
    followers: v.followers,
    collab_signal: v.collab > 0,
  }));
  // PROVEN collaborators first (strongest signal), then by reach. Under a limited
  // crawl budget this ordering decides who actually gets enriched and surfaced.
  matches.sort((a, b) => {
    const ca = a.collab_signal ? 1 : 0;
    const cb = b.collab_signal ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return b.followers - a.followers;
  });
  return matches.slice(0, limit);
}

// Validate a list of (possibly AI-suggested) handles against Instagram and
// return scored LiveProfiles. Degrades gracefully so a throttled/dead cookie
// doesn't wipe out real, web-sourced AI suggestions:
//   200 + user     → fully validated & enriched (followers, bio, ER)
//   404 / 200 null  → handle doesn't exist → DROPPED (this filters hallucinations)
//   401/429/timeout → couldn't verify (cookie down) → kept as an UNVERIFIED stub
//                     (marked, enriched later via the drawer / a future search)
// Capped + throttled to protect the session, stops early on time budget.
export async function profilesFromHandles(
  handles: string[],
  tokens: string[],
  opts: { max?: number; delayMs?: number; budgetMs?: number } = {},
): Promise<LiveProfile[]> {
  const max = opts.max ?? 12;
  const delayMs = opts.delayMs ?? 350;
  const budgetMs = opts.budgetMs ?? 16_000;
  const startedAt = Date.now();
  const seen = new Set<string>();
  const out: LiveProfile[] = [];
  // `max`/`budgetMs` now cap only how many handles we LIVE-VALIDATE against IG
  // (the slow, rate-limited part) — NOT how many we keep. Every handle the prompt
  // surfaces is kept: validated ones with full data, the rest as stubs the caller
  // persists and enriches later. Only handles IG confirms as non-existent are
  // dropped (the hallucination filter). So "whatever comes up — 10, 15, 20 —"
  // all lands in the DB.
  let validated = 0;
  // As soon as the free cookie pool signals it's dead/throttled (the first
  // 401/403/429/timeout), we STOP hammering it handle-by-handle: further handles
  // are collected and hydrated in ONE batched Apify run at the end. This is both
  // faster (no per-handle cold-start) and cheaper (one billed run, not N) than the
  // old per-handle Apify fallback — "cookie dead → switch to Apify" as a mode, not
  // a per-call retry.
  let poolBlocked = false;
  const blocked: string[] = []; // handles the dead pool couldn't verify → batch Apify
  for (const raw of handles) {
    const h = raw.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9._]{2,30}$/.test(h) || seen.has(h)) continue;
    seen.add(h);
    // Once the pool is known-dead, don't spend the free path on the rest — queue
    // them straight for the batched Apify run below.
    if (poolBlocked) {
      blocked.push(h);
      continue;
    }
    if (validated >= max || Date.now() - startedAt > budgetMs) {
      out.push(stubProfile(h, tokens)); // over validation budget → keep as stub, don't drop
      continue;
    }
    validated++;
    const { user, status } = await fetchProfileWithStatus(h, budgetMs - (Date.now() - startedAt));
    await sleep(delayMs);
    if (user?.username) {
      out.push({ ...summarize(user, tokens), from_ai: true });
    } else if (status === 404 || status === 200) {
      continue; // confirmed not to exist → drop (real hallucination filter)
    } else {
      // Free path blocked (401/403/429/timeout) → the pool is dead/throttled. Flip
      // to Apify mode: queue THIS handle and route every remaining handle to the
      // single batched Apify run instead of retrying dead cookies one at a time.
      poolBlocked = true;
      blocked.push(h);
    }
  }
  // One batched Apify run for everything the dead pool couldn't verify. Bounded to
  // `max` so a fully-dead pool can't fan an unbounded paid run; the rest stub out.
  if (blocked.length > 0) {
    const toEnrich = blocked.slice(0, max);
    const hydrated = await apifyProfilesAsRawUsers(toEnrich, budgetMs);
    for (const h of blocked) {
      const user = hydrated.get(h);
      out.push(
        user?.username
          ? { ...summarize(user, tokens), from_ai: true }
          : stubProfile(h, tokens),
      );
    }
  }
  return out;
}

// Enrich a set of handles through ONE batched Apify run, mapped to display-ready
// LiveProfiles. This is the reliability path for OpenAI-suggested creators: the
// web-search suggester names REAL Indian creators (Komal Pandey, thatbohogirl…),
// but when the free cookie pool is throttled, per-handle validation returns
// 0-follower stubs that the results filter drops — so the names GPT found never
// show. One batch run hydrates them all with real follower/post data in a single
// cold-start, so a campaign / cold search returns a full, ChatGPT-style page
// instead of an empty one. No-op (empty) without APIFY_TOKEN.
export async function enrichHandlesViaApifyBatch(
  handles: string[],
  tokens: string[],
  timeoutMs = 45_000,
): Promise<LiveProfile[]> {
  const clean = Array.from(
    new Set(
      handles
        .map((h) => h.trim().toLowerCase().replace(/^@/, ''))
        .filter((h) => /^[a-z0-9._]{2,30}$/.test(h)),
    ),
  );
  if (clean.length === 0) return [];
  const users = await apifyProfilesAsRawUsers(clean, timeoutMs);
  const out: LiveProfile[] = [];
  for (const user of users.values()) {
    if (user?.username) out.push({ ...summarize(user, tokens), from_ai: true });
  }
  return out;
}

// A minimal, unverified profile for an AI-suggested handle we couldn't confirm
// on Instagram right now (session throttled/down). Scored off the handle text
// so niche/city tokens still rank it. Enriched later when the cookie recovers.
function stubProfile(username: string, tokens: string[]): LiveProfile {
  const prof: Omit<LiveProfile, 'score'> = {
    username,
    full_name: '',
    biography: '',
    category: '',
    followers: 0,
    is_private: false,
    is_verified: false,
    profile_pic_url: null,
    engagement: 0,
    email: null,
    phone: null,
    link: null,
  };
  return { ...prof, score: scoreProfile(prof, tokens), unverified: true, from_ai: true };
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{9}/;

// Pull contact details for outreach: an email (from the business/public email
// field or the bio text), an Indian phone number from the bio, and the bio link.
export function extractContact(
  bio: string | null | undefined,
  opts: { businessEmail?: string | null; publicEmail?: string | null; externalUrl?: string | null } = {},
): { email: string | null; phone: string | null; link: string | null } {
  const b = bio ?? '';
  const email = opts.businessEmail || opts.publicEmail || b.match(EMAIL_RE)?.[0] || null;
  const phone = b.match(PHONE_RE)?.[0]?.replace(/[\s-]/g, '') ?? null;
  return { email, phone, link: opts.externalUrl || null };
}

// India-only platform: decide whether an enriched profile is Indian from its own
// text (name + bio + category + external link). Returns:
//   true      — a positive India signal (Indian city/state, "india", ₹, +91, a
//               .in link, or an Indian-script character) → surfaces normally.
//   false     — a positive FOREIGN signal (a foreign city/country, £/€, a foreign
//               ccTLD) AND no India signal → known-foreign, SINKS in ranking.
//   undefined — no signal either way → treated as Indian (safe default; we don't
//               punish a sparse bio on an India-only platform).
// This is what makes Apify enrichment (and the free crawl) India-centric: a global
// #vegan / #denim account that Apify returns gets flagged foreign here and drops
// below the real Indian creators, instead of padding the page with UK/US handles.
const FOREIGN_MARKERS = [
  'london', 'uk', 'united kingdom', 'england', 'manchester', 'usa', 'u.s.a', 'united states',
  'new york', 'nyc', 'los angeles', 'california', 'texas', 'chicago', 'canada', 'toronto',
  'australia', 'sydney', 'melbourne', 'dubai', 'uae', 'singapore', 'germany', 'berlin',
  'france', 'paris', 'netherlands', 'amsterdam', 'spain', 'italy', 'pakistan', 'bangladesh',
  'nepal', 'sri lanka',
];
function detectIndian(text: string, externalUrl?: string | null): boolean | undefined {
  const t = ` ${text.toLowerCase()} `;
  const url = (externalUrl ?? '').toLowerCase();
  // Positive India signals.
  const indianScript = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/.test(text);
  const wordHit = (w: string) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(t);
  const indiaSignal =
    indianScript ||
    /\+91|₹|\binr\b/.test(t) ||
    /\.in(\/|$|\b)/.test(url) ||
    wordHit('india') || wordHit('indian') || wordHit('bharat') || wordHit('desi') ||
    [...KNOWN_CITIES].some((c) => wordHit(c)) ||
    Object.keys(STATE_CITIES).some((s) => wordHit(s));
  if (indiaSignal) return true;
  // Negative (foreign) signals — only decisive when there's no India signal.
  const foreignSignal =
    /£|€|\.co\.uk|\.com\.au|\bgbp\b|\busd\b/.test(t) ||
    FOREIGN_MARKERS.some((m) => wordHit(m));
  if (foreignSignal) return false;
  return undefined;
}

function summarize(user: RawUser, tokens: string[]): LiveProfile {
  const followers = user.edge_followed_by?.count ?? 0;
  const contact = extractContact(user.biography, {
    businessEmail: user.business_email,
    publicEmail: user.public_email,
    externalUrl: user.external_url,
  });
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
    email: contact.email,
    phone: contact.phone,
    link: contact.link,
    is_indian: detectIndian(
      `${user.username ?? ''} ${user.full_name ?? ''} ${user.biography ?? ''} ${user.category_name ?? ''}`,
      user.external_url,
    ),
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

  // 1) SEEDS — the creators we discovered and will display. Two-stage enrichment:
  //    (a) try the FREE cookie path concurrently for every seed (fast + no cost
  //        when the relay is alive), then
  //    (b) for whatever the free path couldn't resolve (relay down / cookie
  //        blocked), enrich them all in ONE batched Apify run.
  //    Batching is the throughput fix: a per-profile Apify run costs a 20–60s
  //    cold-start, so enriching seeds one-at-a-time only surfaced ~1 result before
  //    the budget ran out. One run returns the whole seed set at once — that's how
  //    a dead-cookie campaign page actually fills.
  const seedConcurrency = options.seedConcurrency ?? 12;
  const apifyDirect = options.apifyDirect ?? false;
  const seedList = cleanSeeds.slice(0, max);
  // Free cookie stage. Campaign mode (apifyDirect) SKIPS this and goes straight to
  // the batched Apify run below — both because the user wants "campaign → Apify"
  // and because it removes a latency variable: a stale/slow relay can hang each
  // free fetch up to its abort, eating the window the batch needs. Normal mode
  // enriches free-first and only the misses fall to Apify.
  const seedUsers: Map<string, RawUser> = apifyDirect
    ? new Map()
    : await fetchProfilesConcurrent(
        seedList,
        Math.min(budgetMs, 8_000), // short free-first window; batch Apify gets the rest
        false, // free path only here; misses go to the batched Apify run below
        seedConcurrency,
      );
  // Whatever the free cookie path couldn't resolve → enrich in ONE Apify run.
  // Measured: a ~13-handle batch returns full data in ~35s, so we cap the batch
  // (APIFY_BATCH_CAP) to keep the run comfortably inside the request's 60s ceiling
  // while still returning well over the "10+ creators" bar. The race timeout is the
  // remaining budget, which the caller sizes so the batch has room to finish.
  const APIFY_BATCH_CAP = 14;
  const missing = seedList.filter((u) => !seedUsers.get(u)?.username).slice(0, APIFY_BATCH_CAP);
  if (missing.length > 0) {
    const remaining = budgetMs - (Date.now() - startedAt);
    if (remaining > 8_000) {
      const viaApify = await apifyProfilesAsRawUsers(missing, remaining);
      for (const [h, user] of viaApify) seedUsers.set(h, user);
    }
  }
  const queue: Array<{ username: string; hop: number }> = [];
  for (const username of cleanSeeds) {
    const user = seedUsers.get(username);
    if (!user?.username) continue;
    visited.set(username, summarize(user, tokens));
    if (depth > 0) {
      for (const next of discoverLinks(user)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push({ username: next, hop: 1 });
        }
      }
    }
  }

  // 2) GRAPH EXPANSION (hop ≥ 1) — politely serialized. Normally free-only, but
  //    when the cookie pool is throttled the free crawl yields nothing and the page
  //    degrades to just the 1–2 seed profiles. So we let a BOUNDED number of the
  //    FIRST expansion nodes fall through to paid Apify. Actual spend only happens
  //    when the free path returns 401/403/429 (fetchProfile decides) — a healthy
  //    pool free-succeeds and never pays. The cap stops a fully-dead pool from
  //    fanning Apify across the whole crawl. Campaign mode already Apify-batched
  //    its seeds, so it gets no extra expansion budget.
  let apifyExpansionBudget = apifyDirect ? 0 : (options.expansionApifyCap ?? 6);
  while (queue.length > 0 && visited.size < max) {
    if (Date.now() - startedAt > budgetMs) break;
    const { username, hop } = queue.shift()!;

    const allowApify = apifyExpansionBudget > 0;
    if (allowApify) apifyExpansionBudget--;
    const user = await fetchProfile(username, budgetMs - (Date.now() - startedAt), allowApify);
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

// ---- live brand-collaborator crawl --------------------------------------
//
// "Who works with <brand>", crawled LIVE off Instagram instead of read from our
// DB. Same BFS as liveDiscover (seed → related profiles + caption @mentions →
// …), but the KEEP test is brand-specific: we scan each crawled profile's recent
// captions for the brand term and, when it hits, keep that creator with the
// actual matching caption + post URL as proof — mirroring the DB caption scan in
// /api/brand-mentions, just against live-fetched profiles. A weaker bio/name/
// category mention is kept too (flagged 'bio'). The seed brand handles are never
// returned as results. Bounded by depth/max/budget so the request can't hang.

export interface BrandCollabMatch {
  username: string;
  full_name: string;
  biography: string;
  category: string;
  followers: number;
  is_verified: boolean;
  profile_pic_url: string | null;
  engagement: number;
  matched_caption: string | null;
  post_url: string | null;
  match_reason: 'caption' | 'bio';
}

// Scan a live profile's recent posts for the brand; return the first matching
// caption + its post URL (from the media shortcode) as proof, else null.
function captionProof(user: RawUser, rx: RegExp): { caption: string; post_url: string | null } | null {
  for (const edge of user.edge_owner_to_timeline_media?.edges ?? []) {
    const node = edge.node;
    const text = node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
    if (text && rx.test(text)) {
      return { caption: text, post_url: node?.shortcode ? `https://www.instagram.com/p/${node.shortcode}/` : null };
    }
  }
  return null;
}

export async function liveBrandCollabs(
  brand: string,
  seeds: string[],
  options: LiveDiscoveryOptions = {},
): Promise<{ brand: string; seeds: string[]; results: BrandCollabMatch[] }> {
  const depth = options.depth ?? 2;
  const max = options.max ?? 40;
  const delayMs = options.delayMs ?? 350;
  const budgetMs = options.budgetMs ?? 28_000;
  const startedAt = Date.now();

  // Same prefix-at-word-boundary match the /api/brand-mentions caption scan uses,
  // so "@nykaafashion" / "#nykaabeauty" count but mid-word coincidences don't.
  const esc = brand.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(^|[^a-z0-9])${esc}`, 'i');

  const cleanSeeds = seeds
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter((s) => /^[a-z0-9._]{2,30}$/.test(s));
  const seedSet = new Set(cleanSeeds);

  const found = new Map<string, BrandCollabMatch>();
  const seen = new Set<string>(cleanSeeds);
  const queue: Array<{ username: string; hop: number }> = cleanSeeds.map((s) => ({ username: s, hop: 0 }));

  while (queue.length > 0 && found.size < max) {
    if (Date.now() - startedAt > budgetMs) break;
    const { username, hop } = queue.shift()!;

    const user = await fetchProfile(username, budgetMs - (Date.now() - startedAt));
    await sleep(delayMs);
    if (!user || !user.username) continue;

    // Never return the brand's own account(s) as a "creator", but still expand
    // outward from them — their captions/related profiles are the richest source
    // of actual collaborators.
    if (!seedSet.has(user.username.toLowerCase())) {
      const proof = captionProof(user, rx);
      const haystack = `${user.username} ${user.full_name ?? ''} ${user.biography ?? ''} ${user.category_name ?? ''}`;
      if (proof) {
        const followers = user.edge_followed_by?.count ?? 0;
        found.set(user.username.toLowerCase(), {
          username: user.username, full_name: user.full_name ?? '', biography: user.biography ?? '',
          category: user.category_name ?? '', followers, is_verified: Boolean(user.is_verified),
          profile_pic_url: user.profile_pic_url ?? null, engagement: engagementRate(user, followers),
          matched_caption: proof.caption, post_url: proof.post_url, match_reason: 'caption',
        });
      } else if (rx.test(haystack)) {
        const followers = user.edge_followed_by?.count ?? 0;
        found.set(user.username.toLowerCase(), {
          username: user.username, full_name: user.full_name ?? '', biography: user.biography ?? '',
          category: user.category_name ?? '', followers, is_verified: Boolean(user.is_verified),
          profile_pic_url: user.profile_pic_url ?? null, engagement: engagementRate(user, followers),
          matched_caption: null, post_url: null, match_reason: 'bio',
        });
      }
    }

    if (hop < depth) {
      for (const next of discoverLinks(user)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push({ username: next, hop: hop + 1 });
        }
      }
    }
  }

  // Caption-proof creators first (concrete), then reach.
  const results = Array.from(found.values()).sort(
    (a, b) =>
      Number(b.match_reason === 'caption') - Number(a.match_reason === 'caption') ||
      b.followers - a.followers,
  );

  return { brand, seeds: cleanSeeds, results };
}
