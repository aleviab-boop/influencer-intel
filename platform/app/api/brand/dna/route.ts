import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient, type BrandDnaProfile } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/brand/dna
//   { brand, url?, social?, notes? }
//   → { profile: BrandDnaProfile, saved: boolean }
//
// Analyse a brand from its name + website + social with the web-search model and
// return a structured Brand DNA profile, persisting it to brand_dna so the
// campaign-ideas step can reuse it. The front of the brand flow.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const brand = typeof body?.brand === 'string' ? body.brand.trim() : '';
  if (brand.length < 2) {
    return NextResponse.json({ error: 'A brand name is required (min 2 characters).' }, { status: 400 });
  }
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  const social = typeof body?.social === 'string' ? body.social.trim() : '';
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';

  let profile: BrandDnaProfile;
  try {
    profile = await getOpenAIClient().analyzeBrandDna({
      brand,
      url: url || null,
      social: social || null,
      notes: notes || null,
    });
  } catch (err) {
    console.error('[brand/dna] analysis failed:', err);
    return NextResponse.json({ error: 'Could not analyse the brand. Try again.' }, { status: 502 });
  }

  // Persist the analysis (best-effort — the DNA is still returned if the write
  // fails, e.g. before the migration is applied).
  let saved = false;
  try {
    await getBolticClient().query(
      `INSERT INTO brand_dna (brand_name, url, social, profile)
       VALUES ($1, $2, $3, $4)`,
      [brand, url || null, social || null, JSON.stringify(profile)],
    );
    saved = true;
  } catch (err) {
    console.error('[brand/dna] save failed:', err);
  }

  return NextResponse.json({ profile, saved });
}

// GET /api/brand/dna
//   ?brand=NAME → { profile: BrandDnaProfile | null, created_at }
//   (no brand)  → { brands: [{ brand_name, category, created_at }] }  (recent, distinct)
//
// With a brand: the latest saved DNA for it (case-insensitive) — used to sign a
// returning brand back in / reuse an earlier analysis. With no brand: the recent
// distinct brands we've analysed, so the login page can list them to pick from.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const brand = req.nextUrl.searchParams.get('brand')?.trim() ?? '';

  // List mode — recent distinct brands for the login picker.
  if (brand.length < 2) {
    try {
      const brands = await getBolticClient().query<{ brand_name: string; category: string | null; created_at: string }>(
        `SELECT brand_name, category, created_at FROM (
           SELECT DISTINCT ON (lower(brand_name))
                  brand_name, profile->>'category' AS category, created_at
             FROM brand_dna
            ORDER BY lower(brand_name), created_at DESC
         ) t
         ORDER BY created_at DESC
         LIMIT 24`,
      );
      return NextResponse.json({ brands: brands.map((b) => ({ ...b, created_at: String(b.created_at) })) });
    } catch {
      return NextResponse.json({ brands: [] });
    }
  }

  try {
    const rows = await getBolticClient().query<{ profile: BrandDnaProfile; created_at: string }>(
      `SELECT profile, created_at::text AS created_at
         FROM brand_dna
        WHERE lower(brand_name) = lower($1)
        ORDER BY created_at DESC
        LIMIT 1`,
      [brand],
    );
    const row = rows[0];
    return NextResponse.json({ profile: row?.profile ?? null, created_at: row?.created_at ?? null });
  } catch {
    // Table not created yet → nothing saved.
    return NextResponse.json({ profile: null, created_at: null });
  }
}
