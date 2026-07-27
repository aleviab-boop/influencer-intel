import { NextResponse } from 'next/server';
import { igFetch } from '@/lib/ig-fetch';

export const runtime = 'nodejs';

// GET /api/ig-health
//   One quick authenticated probe so the app can tell WHY the scraper is (or
//   isn't) working and surface a clear message:
//     ok        — session is valid, Instagram is responding
//     expired   — 401: the session cookie is stale → user must refresh it
//     throttled — 429 / empty body: Instagram is rate-limiting right now
//     down      — relay/network/other failure
const HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.instagram.com/',
  'Sec-Fetch-Site': 'same-origin',
};

const PROBE_URL =
  'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram';

export async function GET() {
  // Best-of-2 probe. web_profile_info flaps between 200 and 400/empty-body on a
  // single throttled egress IP, so a lone failure isn't actionable — retry once
  // (short pause) before judging, and return the better outcome. 400 and empty
  // bodies are Instagram's soft rate-limit, not a hard failure → 'throttled'.
  let hardStatus = 0; // a non-throttle non-ok status worth surfacing as 'down'
  let soft = false; // saw a throttle-ish outcome (400 / 429 / empty body)
  let relayDown = false; // igFetch threw → relay/tunnel unreachable
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    try {
      const res = await igFetch(PROBE_URL, { headers: HEADERS });
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ status: 'expired' }); // hard auth fail — no retry
      }
      if (res.ok) {
        const u = await res.json().then((j) => j?.data?.user).catch(() => null);
        if (u) return NextResponse.json({ status: 'ok' }); // clean success — stop
        soft = true; // 200 with empty body = soft rate-limit → retry
        continue;
      }
      if (res.status === 400 || res.status === 429) {
        soft = true; // soft throttle → retry
        continue;
      }
      hardStatus = res.status; // 5xx / other → retry, but remember it
      continue;
    } catch {
      relayDown = true;
      continue;
    }
  }
  if (hardStatus) return NextResponse.json({ status: 'down', code: hardStatus });
  if (soft) return NextResponse.json({ status: 'throttled' });
  return NextResponse.json({ status: 'down' }); // relayDown or nothing usable
}
