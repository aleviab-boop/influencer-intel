import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// TEMPORARY diagnostic. Reports whether prod's OpenAI web-search returns handles,
// and whether the free og path can enrich one with engagement. Delete after.
export async function GET(req: NextRequest) {
  const prompt = req.nextUrl.searchParams.get('prompt') ?? 'pottery artist in goa';
  const started = Date.now();
  const out: Record<string, unknown> = {
    keyPresent: !!process.env.OPENAI_API_KEY,
    keyLen: process.env.OPENAI_API_KEY?.length ?? 0,
    keyPrefix: (process.env.OPENAI_API_KEY ?? '').slice(0, 8),
  };
  try {
    const handles = await getOpenAIClient().suggestHandlesFromPrompt(prompt, 20);
    out.suggestOk = true;
    out.count = handles.length;
    out.sample = handles.slice(0, 10);
  } catch (err) {
    const e = err as { name?: string; status?: number; message?: string; code?: string };
    out.suggestOk = false;
    out.errorName = e?.name ?? null;
    out.status = e?.status ?? null;
    out.code = e?.code ?? null;
    out.message = (e?.message ?? String(err)).slice(0, 400);
  }
  out.ms = Date.now() - started;
  return NextResponse.json(out);
}
