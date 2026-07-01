import { NextRequest, NextResponse } from 'next/server';
import { extractContact } from '@/lib/live-discovery';
import { igFetch } from '@/lib/ig-fetch';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';
export const maxDuration = 20;

// GET /api/ig-profile?handle=X
//   Powers the profile drawer. HYBRID model:
//   - The browser worker (scraper workspace) DISCOVERS handles and writes basic
//     creator rows during a crawl. It no longer deep-scrapes each creator.
//   - This endpoint fetches the RICH view (followers, recent posts, live ER,
//     reel-forecast inputs) on demand via the COOKIE scraper (igFetch, through a
//     residential relay/proxy so it works from Vercel). That live payload is what
//     the drawer renders, and we persist it back into `creators` so the DB stays
//     warm.
//   - If the live fetch fails (no relay configured, 401/429, network), we fall
//     back to whatever the DB already has (source 'db'), and if the handle isn't
//     in the DB at all we return a pending shell + queue a worker discovery.

const STALE_MS = 3 * 24 * 60 * 60 * 1000; // consider DB data stale after 3 days
const APP_ID = '936619743392459';
const PROFILE_URL = (u: string) =>
  `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(u)}`;

// Node's fetch (undici) auto-adds Sec-Fetch-* headers IG rejects with a "400
// SecFetch Policy violation"; override them to look like a same-origin XHR.
const REQUEST_HEADERS: Record<string, string> = {
  'x-ig-app-id': APP_ID,
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.instagram.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

// ---- live cookie fetch (web_profile_info gives profile + recent posts) ------

interface MediaNode {
  shortcode?: string;
  is_video?: boolean;
  taken_at_timestamp?: number;
  display_url?: string;
  thumbnail_src?: string;
  video_view_count?: number;
  edge_liked_by?: { count?: number };
  edge_media_preview_like?: { count?: number };
  edge_media_to_comment?: { count?: number };
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
}
interface LiveUser {
  username?: string;
  full_name?: string;
  biography?: string;
  category_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  profile_pic_url_hd?: string;
  profile_pic_url?: string;
  external_url?: string | null;
  business_email?: string | null;
  public_email?: string | null;
  edge_followed_by?: { count?: number };
  edge_follow?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number; edges?: Array<{ node?: MediaNode }> };
  edge_related_profiles?: {
    edges?: Array<{
      node?: {
        username?: string;
        full_name?: string;
        is_verified?: boolean;
        profile_pic_url?: string;
      };
    }>;
  };
}

async function fetchLiveUser(handle: string): Promise<LiveUser | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await igFetch(PROFILE_URL(handle), {
      headers: REQUEST_HEADERS,
      signal: ctrl.signal,
    });
    if (!res.ok) return null; // 401 (no cookie) / 404 / 429 → fall back to DB
    const json = (await res.json()) as { data?: { user?: LiveUser } };
    return json?.data?.user ?? null;
  } catch {
    return null; // network error / abort / relay down / non-JSON login wall
  } finally {
    clearTimeout(timer);
  }
}

function captionOf(node: MediaNode): string {
  return node.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
}

// Persist a live payload so the DB stays warm and the Lander's DB search can
// surface this creator later. Best-effort: never let a persist error break the
// drawer. We only UPDATE rows that already exist (discovery inserts the shell);
// for a brand-new handle we insert a minimal row with a CHECK-valid source.
async function persistLive(handle: string, u: LiveUser, er: number | null, geoPosts: unknown[]) {
  const db = getBolticClient();
  const patch: Record<string, unknown> = {
    display_name: u.full_name ?? '',
    bio: u.biography ?? '',
    follower_count: u.edge_followed_by?.count ?? 0,
    following_count: u.edge_follow?.count ?? 0,
    posts_count: u.edge_owner_to_timeline_media?.count ?? 0,
    is_verified: Boolean(u.is_verified),
    profile_photo_url: u.profile_pic_url_hd ?? u.profile_pic_url ?? null,
    engagement_rate: er != null ? er / 100 : null,
    raw_metadata: { geo: { posts: geoPosts } },
    last_scraped_at: new Date().toISOString(),
  };
  try {
    const rows = await db.query(
      `SELECT 1 FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
    if (rows.length > 0) {
      await db.update('creators', { handle, platform: 'instagram' }, patch);
    } else {
      await db.insert('creators', {
        handle,
        platform: 'instagram',
        is_active: true,
        source: 'scrape',
        ...patch,
      });
    }
  } catch {
    /* ignore — persistence is a nice-to-have, not required for the drawer */
  }
}

// Worker-discovered "similar" creators from the DB (same niche, nearby reach),
// used when the live payload has no related profiles.
interface RelatedRow {
  handle: string;
  display_name: string | null;
  is_verified: boolean | null;
  profile_photo_url: string | null;
}
async function dbRelated(handle: string, niche: string, followers: number) {
  if (!niche) return [];
  try {
    const rows = await getBolticClient().query<RelatedRow>(
      `SELECT handle, display_name, is_verified, profile_photo_url
       FROM creators
       WHERE platform = 'instagram' AND is_active = true
         AND lower(handle) <> lower($1)
         AND lower(coalesce(primary_category, niche, '')) = lower($2)
       ORDER BY abs(coalesce(follower_count, 0) - $3) ASC
       LIMIT 8`,
      [handle, niche, followers],
    );
    return rows
      .map((r) => ({
        handle: r.handle,
        full_name: r.display_name ?? '',
        is_verified: Boolean(r.is_verified),
        profile_pic_url: r.profile_photo_url ?? null,
      }))
      .filter((r) => r.handle);
  } catch {
    return [];
  }
}

// Enqueue an on_demand worker DISCOVERY for a handle we've never seen, unless
// one is already queued/running.
async function enqueueRefresh(handle: string, priority: number): Promise<boolean> {
  const db = getBolticClient();
  try {
    const existing = await db.query(
      `SELECT 1 FROM scrape_jobs
       WHERE job_type = 'on_demand' AND lower(target_handle) = lower($1)
         AND status IN ('queued', 'in_progress') LIMIT 1`,
      [handle],
    );
    if (existing.length > 0) return true;
    await db.insert('scrape_jobs', {
      job_type: 'on_demand',
      target_platform: 'instagram',
      target_handle: handle,
      priority,
      status: 'queued',
      attempts: 0,
      queued_at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

// ---- DB fallback (what the worker discovered / a previous live persist) ------

async function dbProfile(handle: string, force: boolean) {
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await getBolticClient().query<Record<string, unknown>>(
      `SELECT handle, display_name, bio, primary_category, niche, follower_count,
              following_count, posts_count, engagement_rate, profile_photo_url,
              profile_url, is_verified, primary_city, raw_metadata, recent_posts,
              last_scraped_at
       FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
      [handle],
    );
  } catch {
    rows = [];
  }

  const c = rows[0];

  // Not in the DB and live fetch already failed → pending shell + queue worker.
  if (!c) {
    const refreshing = await enqueueRefresh(handle, 0);
    return NextResponse.json({
      handle,
      full_name: '',
      biography: '',
      category: '',
      followers: 0,
      following: 0,
      posts: 0,
      is_verified: false,
      is_private: false,
      profile_pic_url: null,
      external_url: null,
      email: null,
      phone: null,
      recent: [],
      related: [],
      collabs: [],
      sponsored_posts: 0,
      engagement: null,
      source: 'pending',
      refreshing,
      last_scraped_at: null,
    });
  }

  const bio = (c.bio as string) ?? '';
  const contact = extractContact(bio, { externalUrl: (c.profile_url as string) ?? null });
  const er = c.engagement_rate != null ? Math.round(Number(c.engagement_rate) * 1000) / 10 : null;
  const meta = (c.raw_metadata as Record<string, unknown> | null) ?? {};
  const geo = (meta.geo as Record<string, unknown> | null) ?? {};

  const geoPosts = Array.isArray(geo.posts) ? (geo.posts as Array<Record<string, unknown>>) : [];
  const gridPosts = Array.isArray(c.recent_posts) ? (c.recent_posts as Array<Record<string, unknown>>) : [];
  const thumbByCode = new Map<string, string>();
  for (const g of gridPosts) {
    const url = typeof g.post_url === 'string' ? g.post_url : '';
    const code = (g.platform_post_id as string) || url.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] || '';
    const thumb = (g.thumbnail_url as string) || (g.thumbnail as string) || '';
    if (code && thumb) thumbByCode.set(code, thumb);
  }
  let recent = geoPosts.map((p) => {
    const ts = typeof p.timestamp === 'string' && p.timestamp ? Math.floor(Date.parse(p.timestamp as string) / 1000) : null;
    const code = (p.code as string) ?? '';
    return {
      shortcode: code,
      thumbnail: thumbByCode.get(code) ?? null,
      likes: typeof p.likes === 'number' ? p.likes : 0,
      comments: typeof p.comments === 'number' ? p.comments : 0,
      is_video: p.media_type === 'video',
      taken_at: Number.isFinite(ts) ? ts : null,
      caption: (p.caption_excerpt as string) ?? '',
    };
  });
  if (recent.length === 0 && gridPosts.length > 0) {
    recent = gridPosts.map((g) => {
      const url = typeof g.post_url === 'string' ? g.post_url : '';
      const code = (g.platform_post_id as string) || url.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] || '';
      return {
        shortcode: code,
        thumbnail: (g.thumbnail_url as string) || (g.thumbnail as string) || null,
        likes: typeof g.like_count === 'number' ? g.like_count : 0,
        comments: typeof g.comment_count === 'number' ? g.comment_count : 0,
        is_video: g.post_type === 'reel',
        taken_at: null,
        caption: (g.caption as string) ?? '',
      };
    });
  }

  const collabs = Array.isArray(geo.brand_mentions)
    ? (geo.brand_mentions as string[]).slice(0, 12).map((h) => ({ handle: h, count: 1 }))
    : Array.isArray(meta.collabs)
      ? (meta.collabs as Array<{ handle: string; count: number }>)
      : [];
  const sponsored = typeof meta.sponsored_posts === 'number' ? meta.sponsored_posts : 0;
  const niche = ((c.primary_category as string) || (c.niche as string)) ?? '';
  const followers = Number(c.follower_count ?? 0);

  const last = c.last_scraped_at ? new Date(c.last_scraped_at as string).getTime() : 0;
  const stale = !last || Date.now() - last > STALE_MS || recent.length === 0;
  const refreshing = force || stale ? await enqueueRefresh(handle, force ? 0 : 1) : false;

  const related = await dbRelated(handle, niche, followers);

  return NextResponse.json({
    handle: c.handle,
    full_name: (c.display_name as string) ?? '',
    biography: bio,
    category: niche,
    followers,
    following: Number(c.following_count ?? 0),
    posts: Number(c.posts_count ?? 0),
    is_verified: Boolean(c.is_verified),
    is_private: false,
    profile_pic_url: (c.profile_photo_url as string) ?? null,
    external_url: contact.link,
    email: contact.email,
    phone: contact.phone,
    recent,
    related,
    collabs,
    sponsored_posts: sponsored,
    engagement: er,
    source: 'db',
    last_scraped_at: (c.last_scraped_at as string) ?? null,
    refreshing,
  });
}

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    return NextResponse.json({ error: 'bad handle' }, { status: 400 });
  }
  const force = req.nextUrl.searchParams.get('force') === '1';

  // 1) LIVE via the cookie scraper (through the residential relay/proxy). This is
  //    the primary path: real followers, recent posts, live ER, reel-forecast
  //    inputs. Falls through to the DB if it fails.
  const u = await fetchLiveUser(handle);
  if (u && u.username) {
    const edges = u.edge_owner_to_timeline_media?.edges ?? [];
    const followers = u.edge_followed_by?.count ?? 0;

    // recent posts → drawer grid + reel forecast (forecast derives views from likes)
    const recent = edges.map((e) => {
      const n = e.node ?? {};
      const likes = n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0;
      const comments = n.edge_media_to_comment?.count ?? 0;
      const cap = captionOf(n);
      return {
        shortcode: n.shortcode ?? '',
        thumbnail: n.thumbnail_src ?? n.display_url ?? null,
        likes,
        comments,
        is_video: Boolean(n.is_video),
        taken_at: typeof n.taken_at_timestamp === 'number' ? n.taken_at_timestamp : null,
        caption: cap.slice(0, 200),
      };
    });

    // live ER = avg((likes+comments)/followers) across recent posts, as a %
    let er: number | null = null;
    if (followers > 0 && recent.length > 0) {
      const avg = recent.reduce((s, p) => s + p.likes + p.comments, 0) / recent.length;
      er = Math.round((avg / followers) * 1000) / 10;
    }

    // brand mentions in captions → collabs panel
    const mentionCount = new Map<string, number>();
    for (const p of recent) {
      for (const m of p.caption.matchAll(/@([a-z0-9_.]{2,30})/gi)) {
        const h = m[1]!.toLowerCase();
        if (h !== handle.toLowerCase()) mentionCount.set(h, (mentionCount.get(h) ?? 0) + 1);
      }
    }
    const collabs = Array.from(mentionCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([h, count]) => ({ handle: h, count }));

    // IG's own related profiles; fall back to DB "similar" if none.
    const bio = u.biography ?? '';
    const niche = u.category_name ?? '';
    let related = (u.edge_related_profiles?.edges ?? [])
      .map((e) => e.node ?? {})
      .filter((n) => n.username)
      .map((n) => ({
        handle: n.username!,
        full_name: n.full_name ?? '',
        is_verified: Boolean(n.is_verified),
        profile_pic_url: n.profile_pic_url ?? null,
      }));
    if (related.length === 0) related = await dbRelated(handle, niche, followers);

    const contact = extractContact(bio, { externalUrl: u.external_url ?? null });

    // persist for the Lander's DB search + drawer warmth (best-effort)
    const geoPosts = recent.map((p) => ({
      code: p.shortcode,
      likes: p.likes,
      comments: p.comments,
      media_type: p.is_video ? 'video' : 'image',
      timestamp: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : null,
      caption_excerpt: p.caption,
    }));
    await persistLive(handle, u, er, geoPosts);

    return NextResponse.json({
      handle: u.username,
      full_name: u.full_name ?? '',
      biography: bio,
      category: niche,
      followers,
      following: u.edge_follow?.count ?? 0,
      posts: u.edge_owner_to_timeline_media?.count ?? 0,
      is_verified: Boolean(u.is_verified),
      is_private: Boolean(u.is_private),
      profile_pic_url: u.profile_pic_url_hd ?? u.profile_pic_url ?? null,
      external_url: contact.link ?? u.external_url ?? null,
      email: contact.email ?? u.business_email ?? u.public_email ?? null,
      phone: contact.phone,
      recent,
      related,
      collabs,
      sponsored_posts: 0,
      engagement: er,
      source: 'live',
      last_scraped_at: new Date().toISOString(),
      refreshing: false,
    });
  }

  // 2) DB fallback (worker-discovered row or a prior live persist).
  return dbProfile(handle, force);
}
