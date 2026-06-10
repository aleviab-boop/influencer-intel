import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/discover-live/outreach
//   { handle, prompt, category?, channel?: 'dm' | 'email', brand? }
//   → { message } — an AI-drafted first-touch message for the creator.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const handle = typeof body?.handle === 'string' ? body.handle.trim().replace(/^@/, '') : '';
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!handle) {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  }

  const channel = body?.channel === 'email' ? 'email' : 'ig_dm';
  const brand = typeof body?.brand === 'string' && body.brand.trim() ? body.brand.trim() : 'our brand';
  const category = typeof body?.category === 'string' ? body.category.trim() : '';
  const topics = [category, ...prompt.split(/\s+/)].map((t) => t.trim()).filter(Boolean);

  try {
    const message = await getOpenAIClient().generateOutreach({
      brand_name: brand,
      brand_voice_samples: [],
      creator_handle: handle,
      creator_recent_topics: Array.from(new Set(topics)).slice(0, 6),
      campaign_summary: prompt || `collaboration with ${handle}`,
      channel,
    });
    return NextResponse.json({ message });
  } catch (err) {
    console.error('[outreach] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
