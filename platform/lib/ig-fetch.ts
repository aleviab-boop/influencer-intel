import { ProxyAgent } from 'undici';

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
// profile_info returns 401 anonymously). Rather than a bot login (which IG
// blocks), we reuse a real browser session: paste the sessionid cookie (and
// optionally ds_user_id / csrftoken) from a logged-in burner account into env.
// When present, every igFetch carries it, turning the 401 into a 200.
const SESSIONID = process.env.IG_SESSIONID?.trim();
const DS_USER_ID = process.env.IG_DS_USER_ID?.trim();
const CSRFTOKEN = process.env.IG_CSRFTOKEN?.trim();

function withAuth(headers: Record<string, string>): Record<string, string> {
  if (!SESSIONID) return headers;
  const cookie = [
    `sessionid=${SESSIONID}`,
    DS_USER_ID ? `ds_user_id=${DS_USER_ID}` : '',
    CSRFTOKEN ? `csrftoken=${CSRFTOKEN}` : '',
  ].filter(Boolean).join('; ');
  return {
    ...headers,
    Cookie: headers.Cookie ? `${headers.Cookie}; ${cookie}` : cookie,
    ...(CSRFTOKEN ? { 'x-csrftoken': CSRFTOKEN } : {}),
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

export function igFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const authedHeaders = withAuth(headersToObject(init.headers));

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
