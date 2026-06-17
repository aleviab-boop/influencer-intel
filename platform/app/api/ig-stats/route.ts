import { NextRequest, NextResponse } from 'next/server';
import { igFetch } from '@/lib/ig-fetch';

export const runtime = 'nodejs';
export const maxDuration = 20;

// GET /api/ig-stats?handle=X
//   Lightweight live scrape of just the headline stats — fresh followers,
//   engagement %, and profile photo — used to lazily enrich search result rows
//   as they scroll into view. 404 on failure so the row keeps its DB values.
const HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.instagram.com/',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    return NextResponse.json({ error: 'bad handle' }, { status: 400 });
  }
  try {
    const res = await igFetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      { headers: HEADERS },
    );
    if (!res.ok) return NextResponse.json({ error: 'unavailable' }, { status: 404 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u: any = (await res.json())?.data?.user;
    if (!u) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const followers: number | null = u.edge_followed_by?.count ?? null;
    const recent = (u.edge_owner_to_timeline_media?.edges ?? []).slice(0, 9);
    let engagement: number | null = null;
    if (followers && recent.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sum = recent.reduce((s: number, e: any) => {
        const n = e?.node ?? {};
        return s + (n.edge_liked_by?.count ?? 0) + (n.edge_media_to_comment?.count ?? 0);
      }, 0);
      engagement = Math.round((sum / recent.length / followers) * 1000) / 10;
    }
    return NextResponse.json({
      handle: u.username ?? handle,
      followers,
      engagement,
      is_verified: Boolean(u.is_verified),
      profile_pic_url: u.profile_pic_url ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 502 });
  }
}
