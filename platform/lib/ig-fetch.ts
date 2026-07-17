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

const RELAY = process.env.IG_RELAY?.trim();
const RELAY_KEY = process.env.IG_RELAY_KEY?.trim() ?? '';

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

interface SessionCookie {
  sessionid: string;
  ds_user_id?: string;
  csrftoken?: string;
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

function sendOnce(url: string, init: RequestInit, authedHeaders: Record<string, string>): Promise<Response> {
  // Relay takes priority: send the request to the home-IP relay, which fetches
  // Instagram and streams the (status-preserving) response back.
  if (RELAY) {
    return fetch(RELAY, {
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

  // Cap failover attempts so a fully-dead pool doesn't fan out into many IG hits.
  const maxTries = Math.min(candidates.length, 3);
  let res!: Response;
  for (let i = 0; i < maxTries; i++) {
    res = await sendOnce(url, init, withAuth(baseHeaders, candidates[i]!));
    if (res.status !== 401 && res.status !== 403) break; // success or non-auth error → stop
  }
  return res;
}
