import { NextRequest, NextResponse } from 'next/server';
import { extractContact } from '@/lib/live-discovery';
import { igFetch } from '@/lib/ig-fetch';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';
export const maxDuration = 20;

// Fallback when the live Instagram fetch is unavailable (e.g. blocked from a
// cloud server): serve the creator's stored profile from the database so the
// snapshot still shows real stats. Returns a 404 response if not in the DB.
async function dbProfileOr404(handle: string): Promise<NextResponse> {
  try {
    const rows = await getBolticClient().query<Record<string, unknown>>(
      `SELECT handle, display_name, bio, primary_category, niche, follower_count,
              following_count, posts_count, engagement_rate, profile_photo_url,
              profile_url, is_verified, primary_city
       FROM creators WHERE handle = $1 LIMIT 1`,
      [handle.toLowerCase()],
    );
    const c = rows[0];
    if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const bio = (c.bio as string) ?? '';
    const contact = extractContact(bio, { externalUrl: (c.profile_url as string) ?? null });
    const er = c.engagement_rate != null ? Math.round(Number(c.engagement_rate) * 1000) / 10 : null;
    return NextResponse.json({
      handle: c.handle,
      full_name: (c.display_name as string) ?? '',
      biography: bio,
      category: ((c.primary_category as string) || (c.niche as string)) ?? '',
      followers: Number(c.follower_count ?? 0),
      following: Number(c.following_count ?? 0),
      posts: Number(c.posts_count ?? 0),
      is_verified: Boolean(c.is_verified),
      is_private: false,
      profile_pic_url: (c.profile_photo_url as string) ?? null,
      external_url: contact.link,
      email: contact.email,
      phone: contact.phone,
      recent: [],
      related: [],
      collabs: [],
      sponsored_posts: 0,
      engagement: er,
      source: 'db',
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}

// GET /api/ig-profile?handle=X
//   Full public profile + recent posts (login-free). Powers the profile drawer.
const APP_ID = '936619743392459';
const HEADERS: Record<string, string> = {
  'x-ig-app-id': APP_ID,
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
    if (!res.ok) return dbProfileOr404(handle);
    const u = (await res.json())?.data?.user;
    if (!u) return dbProfileOr404(handle);

    const media = u.edge_owner_to_timeline_media?.edges ?? [];
    // Brand-conflict signals: who the creator tags/mentions in recent captions
    // and whether posts look sponsored — so you can spot competitor collabs
    // before reaching out. Computed from the FULL caption (before truncation).
    const SPONSOR_RE = /#(ad|sponsored|paid|paidpartnership|collab|collaboration|partner|brandpartner|sponsoredpost)\b|paid partnership/i;
    const MENTION_RE = /@([A-Za-z0-9_.]{2,30})/g;
    const self = (u.username ?? '').toLowerCase();
    const mentionCounts = new Map<string, number>();
    let sponsoredPosts = 0;

    const recent = media.slice(0, 9).map((e: { node?: Record<string, unknown> }) => {
      const n = (e.node ?? {}) as Record<string, unknown>;
      const caption =
        ((n.edge_media_to_caption as { edges?: { node?: { text?: string } }[] })?.edges?.[0]?.node?.text) ?? '';
      if (SPONSOR_RE.test(caption)) sponsoredPosts++;
      for (const m of caption.matchAll(MENTION_RE)) {
        const h = (m[1] ?? '').toLowerCase().replace(/\.+$/, '');
        if (h && h !== self) mentionCounts.set(h, (mentionCounts.get(h) ?? 0) + 1);
      }
      return {
        shortcode: n.shortcode ?? '',
        thumbnail: (n.thumbnail_src as string) ?? (n.display_url as string) ?? null,
        likes: (n.edge_liked_by as { count?: number })?.count ?? 0,
        comments: (n.edge_media_to_comment as { count?: number })?.count ?? 0,
        is_video: Boolean(n.is_video),
        taken_at: (n.taken_at_timestamp as number) ?? null,
        caption: caption.slice(0, 140),
      };
    });

    const collabs = [...mentionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([handle, count]) => ({ handle, count }));

    const contact = extractContact(u.biography, {
      businessEmail: u.business_email,
      publicEmail: u.public_email,
      externalUrl: u.external_url,
    });

    // Instagram's own "related profiles" — real, login-free similar-creator seeds.
    const relatedEdges = u.edge_related_profiles?.edges ?? [];
    const related = relatedEdges
      .slice(0, 12)
      .map((e: { node?: Record<string, unknown> }) => {
        const n = (e.node ?? {}) as Record<string, unknown>;
        return {
          handle: (n.username as string) ?? '',
          full_name: (n.full_name as string) ?? '',
          is_verified: Boolean(n.is_verified),
          profile_pic_url: (n.profile_pic_url as string) ?? null,
        };
      })
      .filter((r: { handle: string }) => r.handle);

    return NextResponse.json({
      handle: u.username,
      full_name: u.full_name ?? '',
      biography: u.biography ?? '',
      category: u.category_name ?? '',
      followers: u.edge_followed_by?.count ?? 0,
      following: u.edge_follow?.count ?? 0,
      posts: u.edge_owner_to_timeline_media?.count ?? 0,
      is_verified: Boolean(u.is_verified),
      is_private: Boolean(u.is_private),
      profile_pic_url: u.profile_pic_url ?? null,
      external_url: u.external_url ?? null,
      email: contact.email,
      phone: contact.phone,
      recent,
      related,
      collabs,
      sponsored_posts: sponsoredPosts,
    });
  } catch {
    return dbProfileOr404(handle);
  }
}
