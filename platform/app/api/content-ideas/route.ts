import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/content-ideas
//   { prompt }                          → { pack }   (generate a content pack)
//   { prompt, pack, messages }          → { answer } (chat to refine the pack)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 3) {
    return NextResponse.json({ error: 'prompt must be at least 3 characters' }, { status: 400 });
  }
  try {
    // Chat mode: refine an already-generated pack via conversation.
    if (Array.isArray(body?.messages) && body.messages.length > 0) {
      const messages = body.messages
        .filter(
          (m: unknown): m is { role: 'user' | 'assistant'; content: string } =>
            !!m && typeof m === 'object' &&
            ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
            typeof (m as { content?: unknown }).content === 'string',
        )
        .slice(-12);
      const answer = await getOpenAIClient().contentChat({
        prompt,
        pack: body?.pack && typeof body.pack === 'object' ? body.pack : null,
        messages,
      });
      return NextResponse.json({ answer });
    }

    const pack = await getOpenAIClient().generateContentIdeas(prompt);
    return NextResponse.json({ pack });
  } catch (err) {
    console.error('[content-ideas] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
