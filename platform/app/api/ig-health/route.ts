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

export async function GET() {
  try {
    // A stable, always-present account makes a clean probe.
    const res = await igFetch(
      'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram',
      { headers: HEADERS },
    );
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ status: 'expired' });
    }
    if (res.status === 429) {
      return NextResponse.json({ status: 'throttled' });
    }
    if (!res.ok) {
      return NextResponse.json({ status: 'down', code: res.status });
    }
    const u = await res.json().then((j) => j?.data?.user).catch(() => null);
    // 200 but an empty body is Instagram's soft rate-limit.
    if (!u) return NextResponse.json({ status: 'throttled' });
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'down' });
  }
}
