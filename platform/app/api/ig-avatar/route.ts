import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// GET /api/ig-avatar?handle=<username>
//   Resolves a creator's profile photo by handle: looks up the public profile,
//   then streams the (otherwise hotlink-blocked) CDN image back. 404 when the
//   handle doesn't resolve, so the client can fall back to an initial.
const APP_ID = '936619743392459';
const ALLOWED_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    return new NextResponse('bad handle', { status: 400 });
  }

  try {
    const infoRes = await fetch(
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

    const url = new URL(picUrl);
    if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
      return new NextResponse('host not allowed', { status: 400 });
    }

    const imgRes = await fetch(url.toString(), {
      headers: { Referer: 'https://www.instagram.com/', 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' },
    });
    if (!imgRes.ok || !imgRes.body) return new NextResponse('image error', { status: 502 });

    return new NextResponse(imgRes.body, {
      status: 200,
      headers: {
        'Content-Type': imgRes.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new NextResponse('fetch failed', { status: 502 });
  }
}
