import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { type BrandDnaProfile } from '@influencer-intel/shared/llm';
import { buildBrandCollaborators } from '@/lib/brand-collaborators';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/brand/collaborators?brand=NAME
//   → { collaborators: Collaborator[] }
//
// Lazy-loads the "Creators who fit {brand}" list for a brand that ALREADY has a
// saved DNA (a returning workspace, or one that signed up before collaborators
// existed) — so the section populates without re-running the full DNA scrape.
// Grounds the AI creator search + DB niche blend on the saved DNA. Best-effort:
// returns [] when there's no DNA yet or anything hiccups.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const brand = req.nextUrl.searchParams.get('brand')?.trim() ?? '';
  if (brand.length < 2) {
    return NextResponse.json({ error: 'brand is required (min 2 characters)' }, { status: 400 });
  }

  // Reuse the latest saved Brand DNA (case-insensitive) — the collaborator search
  // grounds on what the brand makes, so it needs the DNA.
  let dna: BrandDnaProfile | null = null;
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

  if (!dna || !dna.category) {
    // No DNA to ground on yet — nothing to suggest. The workspace should map DNA first.
    return NextResponse.json({ collaborators: [] });
  }

  const collaborators = await buildBrandCollaborators(brand, dna);
  return NextResponse.json({ collaborators });
}
