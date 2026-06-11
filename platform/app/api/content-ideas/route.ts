import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/content-ideas  { prompt }
//   → { pack: { concept, format, best_window, script[], ideas[], caption, hashtags[] } }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 3) {
    return NextResponse.json({ error: 'prompt must be at least 3 characters' }, { status: 400 });
  }
  try {
    const pack = await getOpenAIClient().generateContentIdeas(prompt);
    return NextResponse.json({ pack });
  } catch (err) {
    console.error('[content-ideas] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
