import { ProxyAgent } from 'undici';
import { getBolticClient } from '@influencer-intel/shared/db';

// Instagram serves its public endpoints to home/residential IPs but blocks
// data-center IPs (so the crawl works locally but not on Vercel/AWS). Two ways
// to make it work on a server:
//
//   IG_RELAY  — point at a relay running on a residential connection (see
//               tools/ig-relay.mjs). Requests are forwarded there, go out over
//               that home IP, and the response comes back. Free.
//   IG_PROXY  — a residential/rotating proxy URL (http://user:pass@host:port).
//
// When neither is set, this behaves exactly like a normal fetch (works locally).

const RELAY_KEY = process.env.IG_RELAY_KEY?.trim() ?? '';

// The relay URL is read from the DB (system_config.relay_url), NOT a fixed env
// var. Why: the free Cloudflare quick-tunnel gets a NEW URL every time it
// restarts (reboot/sleep/drop), and hardcoding it in Vercel meant repasting the
// URL + redeploying on every churn. Now the on-host daemon writes the fresh URL
// to the DB whenever the tunnel restarts, and this reads it (cached ~60s) — so
// the churn propagates itself and live data self-heals with zero manual steps.
// Falls back to the IG_RELAY env var if the DB has no value.
let relayCache: { at: number; url: string | undefined } | null = null;
const RELAY_TTL = 60_000;
async function relayUrl(): Promise<string | undefined> {
  if (relayCache && Date.now() - relayCache.at < RELAY_TTL) return relayCache.url;
  let url = process.env.IG_RELAY?.trim() || undefined;
  try {
    const rows = await getBolticClient().query<{ value: string | null }>(
      `SELECT value FROM system_config WHERE key = 'relay_url'`,
    );
    const dbUrl = rows[0]?.value?.trim();
    if (dbUrl) url = dbUrl; // DB wins when present
  } catch {
    /* DB unreachable → keep the env fallback */
  }
  relayCache = { at: Date.now(), url };
  return url;
}

// Instagram now requires a logged-in session for its data endpoints (web_
// profile_info returns 401 anonymously). We reuse real browser sessions: the
// cookies from logged-in burner accounts. Historically that was ONE cookie in
// env (IG_SESSIONID) — but a single cookie hammered by every drawer/enrichment/
// health-check gets throttled and killed by IG fast (the recurring 401 "Cookie
// rejected"). So we now ROTATE across the captured account pool (service_
// accounts) and fall back to the env cookie, retrying the next session on a
// 401/403 — the live-fetch self-heals instead of going dark on one dead cookie.
const SESSIONID = process.env.IG_SESSIONID?.trim();
const DS_USER_ID = process.env.IG_DS_USER_ID?.trim();
const CSRFTOKEN = process.env.IG_CSRFTOKEN?.trim();

export interface SessionCookie {
  sessionid: string;
  ds_user_id?: string;
  csrftoken?: string;
}

// Pull a SessionCookie out of a Playwright storage_state blob (the shape stored
// in service_accounts.storage_state). Returns null when there's no sessionid.
export function cookieFromStorageState(storage_state: unknown): SessionCookie | null {
  try {
    const ss = (typeof storage_state === 'string' ? JSON.parse(storage_state) : storage_state) as
      | { cookies?: Array<{ name?: string; value?: string; domain?: string }> }
      | null;
    const cs = ss?.cookies ?? [];
    const get = (n: string) =>
      cs.find((x) => x.name === n && String(x.domain ?? '').includes('instagram'))?.value;
    const sessionid = get('sessionid');
    if (!sessionid) return null;
    return { sessionid, ds_user_id: get('ds_user_id'), csrftoken: get('csrftoken') };
  } catch {
    return null;
  }
}

// Rotating pool of session cookies pulled from the captured accounts. Cached
// ~60s so this is at most ~1 DB read/min, not one per fetch.
let poolCache: { at: number; cookies: SessionCookie[] } | null = null;
let rr = 0; // round-robin cursor
const POOL_TTL = 60_000;

async function poolCookies(): Promise<SessionCookie[]> {
  if (poolCache && Date.now() - poolCache.at < POOL_TTL) return poolCache.cookies;
  const cookies: SessionCookie[] = [];
  try {
    const rows = await getBolticClient().query<{ storage_state: unknown }>(
      `SELECT storage_state FROM service_accounts
       WHERE platform = 'instagram' AND status = 'active' AND storage_state IS NOT NULL
         AND (storage_expires_at IS NULL OR storage_expires_at > now())
       ORDER BY storage_captured_at DESC NULLS LAST`,
    );
    for (const r of rows) {
      const ss = (typeof r.storage_state === 'string' ? JSON.parse(r.storage_state) : r.storage_state) as
        | { cookies?: Array<{ name?: string; value?: string; domain?: string }> }
        | null;
      const cs = ss?.cookies ?? [];
      const get = (n: string) =>
        cs.find((x) => x.name === n && String(x.domain ?? '').includes('instagram'))?.value;
      const sessionid = get('sessionid');
      if (sessionid) cookies.push({ sessionid, ds_user_id: get('ds_user_id'), csrftoken: get('csrftoken') });
    }
  } catch {
    /* DB unreachable → fall back to the env cookie only */
  }
  poolCache = { at: Date.now(), cookies };
  return cookies;
}

// Apply a session cookie to the request headers. `override` is a rotated pool
// cookie; when null we use the env cookie (the fallback).
function withAuth(headers: Record<string, string>, override: SessionCookie | null): Record<string, string> {
  const sessionid = override?.sessionid ?? SESSIONID;
  const dsUserId = override?.ds_user_id ?? DS_USER_ID;
  const csrf = override?.csrftoken ?? CSRFTOKEN;
  if (!sessionid) return headers;
  const cookie = [
    `sessionid=${sessionid}`,
    dsUserId ? `ds_user_id=${dsUserId}` : '',
    csrf ? `csrftoken=${csrf}` : '',
  ].filter(Boolean).join('; ');
  return {
    ...headers,
    Cookie: headers.Cookie ? `${headers.Cookie}; ${cookie}` : cookie,
    ...(csrf ? { 'x-csrftoken': csrf } : {}),
  };
}

let cached: ProxyAgent | null | undefined;
function dispatcher(): ProxyAgent | null {
  if (cached !== undefined) return cached;
  const url = process.env.IG_PROXY?.trim();
  cached = url ? new ProxyAgent(url) : null;
  return cached;
}

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}

function sendOnce(url: string, init: RequestInit, authedHeaders: Record<string, string>, relay: string | undefined): Promise<Response> {
  // Relay takes priority: send the request to the home-IP relay, which fetches
  // Instagram and streams the (status-preserving) response back.
  if (relay) {
    return fetch(relay, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'ngrok-skip-browser-warning': 'true', // harmless if not ngrok
        ...(RELAY_KEY ? { 'x-relay-key': RELAY_KEY } : {}),
      },
      body: JSON.stringify({ url, headers: authedHeaders }),
    });
  }
  const d = dispatcher();
  // `dispatcher` isn't in the standard RequestInit type but Node's fetch accepts it.
  return fetch(url, { ...init, headers: authedHeaders, ...(d ? { dispatcher: d } : {}) } as RequestInit);
}

export async function igFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const baseHeaders = headersToObject(init.headers);
  const relay = await relayUrl(); // current tunnel URL from DB (self-updating), env fallback

  // Candidate cookies to try, in order: rotating pool accounts first, env cookie
  // last as a fallback. Rotating the START point spreads load across accounts so
  // no single session is hammered; the retry chain means a dead cookie fails over
  // to the next instead of taking the whole request down.
  const pool = await poolCookies();
  const candidates: (SessionCookie | null)[] = [];
  if (pool.length > 0) {
    const start = rr++ % pool.length;
    for (let i = 0; i < pool.length; i++) candidates.push(pool[(start + i) % pool.length]!);
  }
  if (SESSIONID) candidates.push(null); // env fallback
  if (candidates.length === 0) candidates.push(null); // no auth configured → plain fetch

  // Cap failover attempts so a fully-dead pool doesn't fan out into many IG hits,
  // but keep the cap at least as large as a small pool so a request always reaches
  // the one healthy cookie even when most of the pool is transiently throttled
  // (a burst of fetches can 401 several accounts at once; capping at 3 would then
  // miss the lone survivor and degrade to the DB fallback). Healthy cookies short-
  // circuit on the first JSON 200, so the extra tries only happen while throttled.
  const maxTries = Math.min(candidates.length, 6);
  let res!: Response;
  for (let i = 0; i < maxTries; i++) {
    res = await sendOnce(url, init, withAuth(baseHeaders, candidates[i]!), relay);
    // Fail over to the next account on a dead cookie (401/403) OR a throttle
    // (429): a 429 means THAT session is rate-limited, so retrying with a
    // different, un-throttled account recovers the request instead of returning
    // 429. The retry uses a DIFFERENT account, so it never adds load to the
    // throttled one.
    //
    // ALSO fail over on a 200 that returns HTML: a checkpointed/logged-out cookie
    // doesn't get a 401 — IG serves its login page with HTTP 200 text/html. The
    // status code alone can't catch it, so without this check igFetch would stop
    // on that un-parseable 200 and the whole request silently degrades to the DB
    // fallback (dp + posts go missing) even though a HEALTHY cookie sits next in
    // the pool. Every igFetch caller expects JSON, so an HTML 200 is always a
    // failed auth we should retry past. Any real result (JSON 200, 404, 5xx) → stop.
    const ct = res.headers.get('content-type') ?? '';
    const htmlWall = res.status === 200 && ct.includes('text/html');
    if (res.status !== 401 && res.status !== 403 && res.status !== 429 && !htmlWall) break;
  }
  return res;
}

// Probe ONE specific session cookie (not the pool) against Instagram, returning
// the raw HTTP status. Used by the session-extend cron to decide, per account,
// whether a cookie is still alive (200), dead (401/403), or just throttled
// (429). Goes out through the same relay/proxy path as igFetch so it works from
// Vercel's data-center IP. Returns 0 on a network error/timeout (unknown → the
// caller should leave the account untouched rather than retire a live cookie).
const PROBE_URL = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram';
const PROBE_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  referer: 'https://www.instagram.com/instagram/',
  'x-requested-with': 'XMLHttpRequest',
  'sec-fetch-site': 'same-origin',
};

export async function probeCookie(cookie: SessionCookie): Promise<number> {
  const relay = await relayUrl();
  try {
    const res = await sendOnce(PROBE_URL, {}, withAuth({ ...PROBE_HEADERS }, cookie), relay);
    return res.status;
  } catch {
    return 0; // network/timeout → unknown, don't touch the account
  }
}
