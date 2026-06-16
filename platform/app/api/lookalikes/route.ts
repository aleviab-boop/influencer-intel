import { NextRequest, NextResponse } from 'next/server';
import { igFetch } from '@/lib/ig-fetch';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/lookalikes  { handles: string[] }
//   Lookalike expansion: fan out from the user's saved creators to each one's
//   Instagram "related profiles" (login-free, served by web_profile_info), then
//   dedup across all seeds and rank by recurrence — a creator suggested by more
//   of your saved set is a stronger lookalike. Seeds themselves are excluded.

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

const HANDLE_RE = /^[a-z0-9._]{1,30}$/i;

interface RelatedNode {
  handle: string;
  full_name: string;
  is_verified: boolean;
  profile_pic_url: string | null;
}

interface Lookalike extends RelatedNode {
  count: number; // how many seeds suggested this account
  from: string[]; // which seed handles suggested it
}

async function relatedOf(handle: string): Promise<RelatedNode[]> {
  try {
    const res = await igFetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      { headers: HEADERS },
    );
    if (!res.ok) return [];
    const u = (await res.json())?.data?.user;
    const edges = u?.edge_related_profiles?.edges ?? [];
    return edges
      .map((e: { node?: Record<string, unknown> }) => {
        const n = (e.node ?? {}) as Record<string, unknown>;
        return {
          handle: ((n.username as string) ?? '').toLowerCase(),
          full_name: (n.full_name as string) ?? '',
          is_verified: Boolean(n.is_verified),
          profile_pic_url: (n.profile_pic_url as string) ?? null,
        };
      })
      .filter((r: RelatedNode) => r.handle);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { handles?: unknown } | null;
  const raw = Array.isArray(body?.handles) ? body!.handles : [];
  const seeds = [
    ...new Set(
      raw
        .filter((h): h is string => typeof h === 'string')
        .map((h) => h.trim().replace(/^@/, '').toLowerCase())
        .filter((h) => HANDLE_RE.test(h)),
    ),
  ].slice(0, 10); // cap fan-out to stay within the time budget

  if (seeds.length === 0) {
    return NextResponse.json({ error: 'no valid handles' }, { status: 400 });
  }

  const seedSet = new Set(seeds);
  const results = await Promise.all(seeds.map((h) => relatedOf(h).then((r) => [h, r] as const)));

  const agg = new Map<string, Lookalike>();
  for (const [seed, related] of results) {
    for (const r of related) {
      if (seedSet.has(r.handle)) continue; // exclude the saved creators themselves
      const existing = agg.get(r.handle);
      if (existing) {
        existing.count += 1;
        existing.from.push(seed);
      } else {
        agg.set(r.handle, { ...r, count: 1, from: [seed] });
      }
    }
  }

  const lookalikes = [...agg.values()].sort(
    (a, b) => b.count - a.count || Number(b.is_verified) - Number(a.is_verified),
  );

  const reached = results.filter(([, r]) => r.length > 0).length;

  return NextResponse.json({
    seeds,
    seeds_reached: reached, // how many seeds returned related data (relay/live health)
    count: lookalikes.length,
    lookalikes,
  });
}
