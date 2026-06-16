import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
// Cache 30 min: trending doesn't change minute-to-minute and the YouTube API
// has a daily quota, so we never hammer it.
export const revalidate = 1800;

// GET /api/shorts → { items: ShortItem[], updatedAt, error? }
//   Today's trending short-form videos in India (YouTube Shorts), so creators
//   can see what topics/formats are blowing up and make their own version.
//
// Source: YouTube Data API "mostPopular" chart (the official Trending tab),
// filtered to short (<=3 min) videos. Needs a free YOUTUBE_API_KEY — when it's
// absent the route returns a friendly { error: 'no_key' } so the page can guide
// the user to add one, instead of breaking.

export interface ShortItem {
  id: string;
  title: string;
  channel: string;
  views: number;
  likes: number;
  thumbnail: string;
  link: string;
  durationSec: number;
}

// ISO-8601 (PT#H#M#S) → seconds.
function durationSec(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

interface YtVideo {
  id: string;
  snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
}

export async function GET(): Promise<NextResponse> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      { items: [], error: 'no_key', message: 'Add a free YOUTUBE_API_KEY to enable trending Shorts.' },
      { status: 200 },
    );
  }

  const url =
    'https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics' +
    `&chart=mostPopular&regionCode=IN&maxResults=50&key=${key}`;

  try {
    const res = await fetch(url, { next: { revalidate } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[shorts] youtube error', res.status, detail.slice(0, 200));
      return NextResponse.json({ items: [], error: 'youtube_error', status: res.status }, { status: 200 });
    }
    const data = (await res.json()) as { items?: YtVideo[] };
    const all = (data.items ?? []).map((v) => {
      const secs = durationSec(v.contentDetails?.duration ?? '');
      const th = v.snippet?.thumbnails ?? {};
      return {
        id: v.id,
        title: v.snippet?.title ?? '',
        channel: v.snippet?.channelTitle ?? '',
        views: Number(v.statistics?.viewCount ?? 0),
        likes: Number(v.statistics?.likeCount ?? 0),
        thumbnail: (th.medium ?? th.high ?? th.default)?.url ?? '',
        link: `https://www.youtube.com/watch?v=${v.id}`,
        durationSec: secs,
      } satisfies ShortItem;
    });

    // Shorts are <=3 min. If the trending chart is light on short-form, fall
    // back to the full list so the panel is never empty.
    const shorts = all.filter((v) => v.durationSec > 0 && v.durationSec <= 180);
    const list = (shorts.length >= 6 ? shorts : all).sort((a, b) => b.views - a.views).slice(0, 18);

    return NextResponse.json({ items: list, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[shorts] failed:', err);
    return NextResponse.json({ items: [], error: 'fetch_failed' }, { status: 200 });
  }
}
