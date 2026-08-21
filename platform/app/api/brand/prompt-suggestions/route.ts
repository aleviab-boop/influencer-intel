import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient, type BrandDnaProfile } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/brand/prompt-suggestions
//   { brand, q?, dna? }
//   → { suggestions: string[] }
//
// The AI-backed autocomplete behind the brand workspace prompt bar. Instead of
// the old client-side "append a generic category" list, this grounds live
// creator-search suggestions on the brand's saved DNA (niche, audience,
// keywords, archetypes) and — when the user has started typing — completes and
// sharpens their intent. Best-effort: returns [] so the caller can fall back to
// its local suggestions without a visible failure.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const brand = typeof body?.brand === 'string' ? body.brand.trim() : '';
  if (brand.length < 2) return NextResponse.json({ suggestions: [] });
  const q = typeof body?.q === 'string' ? body.q.trim() : '';

  // Prefer the DNA the client already has; otherwise reuse the latest saved one
  // (case-insensitive) so a returning brand still gets grounded suggestions.
  let dna: BrandDnaProfile | null =
    body?.dna && typeof body.dna === 'object' ? (body.dna as BrandDnaProfile) : null;
  if (!dna) {
    try {
      const rows = await getBolticClient().query<{ profile: BrandDnaProfile }>(
        `SELECT profile FROM brand_dna WHERE lower(brand_name) = lower($1)
          ORDER BY created_at DESC LIMIT 1`,
        [brand],
      );
      dna = rows[0]?.profile ?? null;
    } catch {
      dna = null;
    }
  }

  try {
    const suggestions = await getOpenAIClient().suggestSearchPrompts({
      brand,
      category: dna?.category ?? null,
      audience: dna?.target_audience ?? null,
      keywords: dna?.keywords ?? [],
      archetypes: dna?.creator_archetypes ?? [],
      partial: q,
    });
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
