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
      body: JSON.stringify({ url, headers: headersToObject(init.headers) }),
    });
  }

  const d = dispatcher();
  // `dispatcher` isn't in the standard RequestInit type but Node's fetch accepts it.
  return fetch(url, d ? ({ ...init, dispatcher: d } as RequestInit) : init);
}
