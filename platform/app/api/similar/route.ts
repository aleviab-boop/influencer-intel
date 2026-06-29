// AI "find similar creators" — semantic lookalikes.
//
// Given a creator, we use their content embedding (or generate one on the fly
// from bio + niche + cached captions) and run a vector-similarity search over
// the creators directory to surface the most *semantically* similar accounts —
// matched on what they're actually about, not just keyword/handle overlap.

import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import { extractContact, type LiveProfile } from '@/lib/live-discovery';

export const runtime = 'nodejs';
export const maxDuration = 20;

interface CreatorRow {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  niche: string | null;
  genre: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  is_verified: boolean | null;
  profile_photo_url: string | null;
  profile_url: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content_embedding: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw_metadata: any;
  similarity?: number;
}

function toLiveProfile(r: CreatorRow): LiveProfile {
  const bio = r.bio ?? '';
  const contact = extractContact(bio, { externalUrl: r.profile_url ?? null });
  return {
    username: r.handle,
    full_name: r.display_name ?? '',
    biography: bio,
    category: r.primary_category ?? r.niche ?? '',
    followers: Number(r.follower_count ?? 0),
    is_private: false,
    is_verified: Boolean(r.is_verified),
    profile_pic_url: r.profile_photo_url ?? null,
    // similarity (0-1) → a 0-100-ish relevance score for the results header.
    score: Math.round((r.similarity ?? 0) * 100),
    engagement: r.engagement_rate != null ? Math.round(Number(r.engagement_rate) * 1000) / 10 : 0,
    email: contact.email,
    phone: contact.phone,
    link: contact.link,
    creator_id: r.id,
    from: 'db' as const,
  };
}

export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '').toLowerCase();
  const max = Math.min(40, Math.max(5, Number(req.nextUrl.searchParams.get('max')) || 24));
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    return NextResponse.json({ error: 'bad handle' }, { status: 400 });
  }

  const db = getBolticClient();
  let src: CreatorRow | undefined;
  try {
    const rows = await db.query<CreatorRow>(
      `SELECT id, handle, display_name, bio, primary_category, niche, genre,
              follower_count, content_embedding, raw_metadata
       FROM creators WHERE platform = 'instagram' AND lower(handle) = $1 LIMIT 1`,
      [handle],
    );
    src = rows[0];
  } catch {
    return NextResponse.json({ error: 'db' }, { status: 500 });
  }
  if (!src) return NextResponse.json({ error: 'not_found', message: 'Creator not in your database.' }, { status: 404 });

  // 1. Source embedding — reuse the stored one, else build text and embed.
  let embedding: number[] | null = Array.isArray(src.content_embedding) ? (src.content_embedding as number[]) : null;
  if (!embedding) {
    const captions: string[] = Array.isArray(src.raw_metadata?.recent_posts)
      ? src.raw_metadata.recent_posts.map((p: { caption?: string }) => p.caption ?? '').filter(Boolean).slice(0, 8)
      : [];
    const text = [src.display_name, src.primary_category, src.niche, src.genre, src.bio, ...captions]
      .filter(Boolean).join(' ').trim();
    if (!text) return NextResponse.json({ error: 'no_signal', message: 'Not enough info on this creator to find lookalikes — open their profile first.' }, { status: 422 });
    try {
      embedding = await getOpenAIClient().embed(text);
    } catch {
      return NextResponse.json({ error: 'embed_failed' }, { status: 502 });
    }
  }

  // 2. Vector-similarity search over the directory, excluding the source.
  let results: LiveProfile[];
  try {
    const rows = await db.vectorSearch<CreatorRow>(
      'creators',
      'content_embedding',
      embedding,
      max + 1,
      { sql: `is_active = true AND content_embedding IS NOT NULL AND lower(handle) <> $1`, params: [handle] },
    );
    results = rows
      .filter((r) => r.handle && r.handle.toLowerCase() !== handle)
      .slice(0, max)
      .map(toLiveProfile);
  } catch {
    return NextResponse.json({ error: 'search_failed' }, { status: 500 });
  }

  return NextResponse.json({ source: src.handle, results });
}
