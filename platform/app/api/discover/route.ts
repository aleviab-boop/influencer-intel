import { NextRequest, NextResponse } from 'next/server';
import { runDiscovery } from '@/lib/discovery-service';

export const runtime = 'nodejs';

// POST /api/discover  { prompt: string }
//   → { prompt, parsed_spec, results: DiscoveredInfluencer[] }
//
// Phase 1: natural-language prompt in, scored + stored influencer shortlist
// out. Persists to creators (enrichment) + discovery_results (per-prompt rank).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.prompt !== 'string' || body.prompt.trim().length < 3) {
    return NextResponse.json({ error: 'prompt must be at least 3 characters' }, { status: 400 });
  }

  // Optional override of the Phase 2 quality gate (default 80). Clamp to 0-100.
  const minQuality =
    typeof body.min_quality === 'number'
      ? Math.max(0, Math.min(100, body.min_quality))
      : undefined;

  try {
    const out = await runDiscovery(body.prompt.trim(), { minQuality });
    return NextResponse.json(out);
  } catch (err) {
    console.error('[discover] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
