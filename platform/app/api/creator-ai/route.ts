import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/creator-ai
//   { handle, full_name?, category?, followers, engagement?, rate?, themes?,
//     cadence?, biography?, recent_captions?, tagged_accounts?, question? }
//   → { brands, content, summary, answer }
//
// Powers the profile drawer's "Ask AI" panel: brand-work extraction, a content
// summary, and (when a question is asked) a campaign-fit answer — all grounded
// in the creator's own engagement + content signals.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const handle = typeof body?.handle === 'string' ? body.handle.trim().replace(/^@/, '') : '';
  if (!handle) {
    return NextResponse.json({ error: 'handle required' }, { status: 400 });
  }
  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 20) : [];

  const shared = {
    handle,
    full_name: typeof body?.full_name === 'string' ? body.full_name : null,
    category: typeof body?.category === 'string' ? body.category : null,
    followers: Number(body?.followers ?? 0),
    engagement: body?.engagement != null ? Number(body.engagement) : null,
    rate: typeof body?.rate === 'string' ? body.rate : null,
    themes: toStrArr(body?.themes),
    cadence: typeof body?.cadence === 'string' ? body.cadence : null,
    biography: typeof body?.biography === 'string' ? body.biography : null,
    recent_captions: toStrArr(body?.recent_captions),
    tagged_accounts: toStrArr(body?.tagged_accounts),
  };

  try {
    // Chat mode: a conversation history is present → continue the thread.
    if (Array.isArray(body?.messages) && body.messages.length > 0) {
      const messages = body.messages
        .filter(
          (m: unknown): m is { role: 'user' | 'assistant'; content: string } =>
            !!m && typeof m === 'object' &&
            ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
            typeof (m as { content?: unknown }).content === 'string',
        )
        .slice(-12);
      const answer = await getOpenAIClient().creatorChat({ ...shared, messages });
      return NextResponse.json({ answer });
    }

    // Default: auto-insight (brands / known-for / summary) + optional one-shot question.
    const insight = await getOpenAIClient().creatorInsight({
      ...shared,
      question: typeof body?.question === 'string' ? body.question : null,
    });
    return NextResponse.json(insight);
  } catch (err) {
    console.error('[creator-ai] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
