import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 30;

const LANG_LABEL: Record<string, string> = {
  hinglish: 'Hinglish (a natural Romanized Hindi-English mix, in Latin script)',
  hindi: 'Hindi (Devanagari script)',
  english: 'English',
};

// POST /api/reply
//   { reply, goal?, brand?, channel?: 'dm'|'email', language? }
//   → { suggestions: [{ label, message }] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const reply = typeof body?.reply === 'string' ? body.reply.trim() : '';
  if (reply.length < 3) {
    return NextResponse.json({ error: 'paste the creator\u2019s message first' }, { status: 400 });
  }
  const channel = body?.channel === 'email' ? 'email' : 'ig_dm';
  const lang = typeof body?.language === 'string' ? body.language.trim().toLowerCase() : 'english';
  try {
    const suggestions = await getOpenAIClient().generateReply({
      creator_reply: reply,
      goal: typeof body?.goal === 'string' ? body.goal : '',
      brand_name: typeof body?.brand === 'string' ? body.brand : '',
      channel,
      language: LANG_LABEL[lang] ?? '',
    });
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('[reply] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
