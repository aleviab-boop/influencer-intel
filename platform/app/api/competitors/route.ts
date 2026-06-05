import { NextRequest, NextResponse } from 'next/server';
import { getCompetitorAnalysis } from '@/lib/competitors-service';

export const runtime = 'nodejs';

// GET /api/competitors?a=BrandA&b=BrandB → creators per brand + overlap
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const a = (url.searchParams.get('a') ?? '').trim();
  const b = (url.searchParams.get('b') ?? '').trim() || null;
  if (a.length < 2) {
    return NextResponse.json({ error: 'a (brand) must be at least 2 characters' }, { status: 400 });
  }
  try {
    const data = await getCompetitorAnalysis(a, b);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[competitors] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
