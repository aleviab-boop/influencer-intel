import { NextRequest, NextResponse } from 'next/server';
import { igFetch } from '@/lib/ig-fetch';
import { fetchProfileOgImage } from '@/lib/og-proxy';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// GET /api/ig-avatar?handle=<username>
//   Streams a creator's profile photo (otherwise hotlink-blocked). Prefers the
//   photo URL cached in the DB (set on the last profile crawl) so we DON'T spend
//   a rate-limited profile API call just for an avatar; only falls back to a
//   live profile lookup when there's no cached URL or it has expired. 404 when
//   the handle doesn't resolve, so the client can fall back to an initial.
const APP_ID = '936619743392459';
const ALLOWED_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Fetch a CDN image URL and return a streaming image response, or null if the
// URL is invalid / blocked / expired.
async function streamImage(picUrl: string): Promise<NextResponse | null> {
  let url: URL;
  try { url = new URL(picUrl); } catch { return null; }
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) return null;
  const headers = { Referer: 'https://www.instagram.com/', 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' };

  // Direct fetch first — IG's media CDN serves images to any IP, so this works
  // (and stays up even when the residential relay is down); relay is the fallback.
  let imgRes: Response | null = null;
  try {
    const direct = await fetch(url.toString(), { headers });
    if (direct.ok && direct.body) imgRes = direct;
  } catch {
    /* fall through to the relay */
  }
  if (!imgRes) {
    try {
      const relayed = await igFetch(url.toString(), { headers });
      if (relayed.ok && relayed.body) imgRes = relayed;
    } catch {
      /* both hops failed */
    }
  }
  if (!imgRes) return null;
  return new NextResponse(imgRes.body, {
    status: 200,
    headers: {
      'Content-Type': imgRes.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    return new NextResponse('bad handle', { status: 400 });
  }

  // 1) Cached photo URL — no profile API call needed.
  try {
    const rows = await getBolticClient().query<{ profile_photo_url: string | null }>(
      `SELECT profile_photo_url FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
    const cached = rows[0]?.profile_photo_url;
    if (cached) {
      const streamed = await streamImage(cached);
      if (streamed) return streamed; // cached URL still valid
      // else: URL expired → fall through to a fresh lookup
    }
  } catch {
    /* DB unreachable — fall through to the live lookup */
  }

  // 2) FREE og-proxy lookup — fetches the public profile PAGE through the home-IP
  //    og proxy and reads og:image (the profile photo). Cookieless, page-only, so
  //    it NEVER touches the throttled web_profile_info endpoint and works even
  //    while that endpoint is in cooldown. This is what fills avatars for creators
  //    we've never crawled, at zero cost.
  try {
    const ogPic = await fetchProfileOgImage(handle);
    if (ogPic) {
      void getBolticClient()
        .query(`UPDATE creators SET profile_photo_url = $2, updated_at = now() WHERE platform = 'instagram' AND lower(handle) = lower($1)`, [handle, ogPic])
        .catch(() => {});
      const streamed = await streamImage(ogPic);
      if (streamed) return streamed;
      // else: og:image didn't stream (rare) → fall through to the live lookup
    }
  } catch {
    /* og proxy down → fall through to the live lookup */
  }

  // 3) Live lookup (also refreshes the cached URL via the crawl path elsewhere).
  try {
    const infoRes = await igFetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      {
        headers: {
          'x-ig-app-id': APP_ID,
          'User-Agent': UA,
          Accept: '*/*',
          Referer: 'https://www.instagram.com/',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
        },
      },
    );
    if (!infoRes.ok) return new NextResponse('not found', { status: 404 });
    const json = (await infoRes.json()) as { data?: { user?: { profile_pic_url?: string } } };
    const picUrl = json?.data?.user?.profile_pic_url;
    if (!picUrl) return new NextResponse('no photo', { status: 404 });

    // Cache the fresh URL for next time (best-effort).
    void getBolticClient()
      .query(`UPDATE creators SET profile_photo_url = $2, updated_at = now() WHERE platform = 'instagram' AND lower(handle) = lower($1)`, [handle, picUrl])
      .catch(() => {});

    const streamed = await streamImage(picUrl);
    return streamed ?? new NextResponse('image error', { status: 502 });
  } catch {
    return new NextResponse('fetch failed', { status: 502 });
  }
}
