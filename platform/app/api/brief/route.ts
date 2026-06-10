import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/brief  { prompt }
//   → { brief: { hook, format, cta, best_window } }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 4) {
    return NextResponse.json({ error: 'prompt must be at least 4 characters' }, { status: 400 });
  }
  try {
    const brief = await getOpenAIClient().generateCampaignBrief(prompt);
    return NextResponse.json({ brief });
  } catch (err) {
    console.error('[brief] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
