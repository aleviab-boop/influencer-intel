import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// TEMPORARY diagnostic: runs the AI web-search handle suggester in the PROD
// environment (prod OPENAI_API_KEY) and reports whether it works — WITHOUT
// exposing the key. Delete after debugging.
export async function GET(req: NextRequest) {
  const prompt = req.nextUrl.searchParams.get('prompt') ?? 'sports creator in bihar';
  const started = Date.now();
  const keyPresent = !!process.env.OPENAI_API_KEY;
  const keyLen = process.env.OPENAI_API_KEY?.length ?? 0;
  const keyPrefix = (process.env.OPENAI_API_KEY ?? '').slice(0, 7);
  try {
    const handles = await getOpenAIClient().suggestHandlesFromPrompt(prompt, 20);
    return NextResponse.json({
      ok: true,
      keyPresent,
      keyLen,
      keyPrefix,
      count: handles.length,
      sample: handles.slice(0, 8),
      ms: Date.now() - started,
    });
  } catch (err) {
    const e = err as { name?: string; status?: number; message?: string; code?: string };
    return NextResponse.json({
      ok: false,
      keyPresent,
      keyLen,
      keyPrefix,
      errorName: e?.name ?? null,
      status: e?.status ?? null,
      code: e?.code ?? null,
      message: (e?.message ?? String(err)).slice(0, 300),
      ms: Date.now() - started,
    });
  }
}
