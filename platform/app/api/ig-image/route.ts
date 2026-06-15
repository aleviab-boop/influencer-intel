import { NextRequest, NextResponse } from 'next/server';
import { igFetch } from '@/lib/ig-fetch';

export const runtime = 'nodejs';

// GET /api/ig-image?u=<instagram cdn url>
//   Proxies an Instagram profile photo. The IG CDN blocks hotlinking from the
//   browser (403 / CORS), so we fetch it server-side with a Referer and stream
//   it back. Host is allowlisted to Instagram CDNs to prevent SSRF.
const ALLOWED_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('u');
  if (!raw) return new NextResponse('missing u', { status: 400 });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new NextResponse('bad url', { status: 400 });
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
    return new NextResponse('host not allowed', { status: 400 });
  }

  try {
    const res = await igFetch(url.toString(), {
      headers: {
        Referer: 'https://www.instagram.com/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok || !res.body) return new NextResponse('upstream error', { status: 502 });

    return new NextResponse(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new NextResponse('fetch failed', { status: 502 });
  }
}
