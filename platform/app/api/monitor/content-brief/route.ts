import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { Creator } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

// POST /api/monitor/content-brief  { creator_id, campaign? }
//   → one production-ready reel concept tailored to the creator + campaign.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.creator_id !== 'string') {
    return NextResponse.json({ error: 'creator_id is required' }, { status: 400 });
  }

  try {
    const db = getBolticClient();
    const creator = await db.findById<Creator>('creators', body.creator_id);
    if (!creator) return NextResponse.json({ error: 'creator not found' }, { status: 404 });

    const vision = (creator.raw_metadata as { vision?: { content_themes?: string[] } } | null)?.vision;
    const themes = Array.isArray(vision?.content_themes) ? vision!.content_themes! : [];

    const llm = getOpenAIClient();
    const brief = await llm.generateContentBrief({
      handle: creator.handle,
      display_name: creator.display_name,
      niche: creator.niche ?? creator.primary_category,
      genre: creator.genre,
      content_themes: themes,
      campaign: typeof body.campaign === 'string' ? body.campaign : null,
    });

    return NextResponse.json({ brief });
  } catch (err) {
    console.error('[content-brief] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
