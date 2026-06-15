import { ProxyAgent } from 'undici';

// Instagram serves its public endpoints to home/residential IPs but blocks
// data-center IPs (so the crawl works locally but not on Vercel/AWS). Setting
// IG_PROXY to a residential/rotating proxy URL (e.g.
// http://user:pass@host:port) routes the Instagram requests through it. When
// IG_PROXY is unset, this behaves exactly like a normal fetch.
let cached: ProxyAgent | null | undefined;
function dispatcher(): ProxyAgent | null {
  if (cached !== undefined) return cached;
  const url = process.env.IG_PROXY?.trim();
  cached = url ? new ProxyAgent(url) : null;
  return cached;
}

export function igFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const d = dispatcher();
  // `dispatcher` isn't in the standard RequestInit type but Node's fetch accepts it.
  return fetch(url, d ? ({ ...init, dispatcher: d } as RequestInit) : init);
}
