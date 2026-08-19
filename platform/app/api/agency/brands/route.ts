import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getAgencySession } from '@/lib/auth';
import type { BrandDnaProfile } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';

// GET /api/agency/brands
//   → { brands: [{ brand, category, dna, created_at }] }  (this account's brands)
//
// The signed-in agency's roster, sourced server-side: the latest saved DNA per
// brand they own (brand_dna.account_id = them). Requires an agency session; the
// full DNA is returned so the client can hydrate its roster for instant switching.
export async function GET(): Promise<NextResponse> {
  const s = await getAgencySession();
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  try {
    const rows = await getBolticClient().query<{
      brand_name: string;
      category: string | null;
      profile: BrandDnaProfile;
      created_at: string;
    }>(
      `SELECT brand_name, profile->>'category' AS category, profile, created_at
         FROM (
           SELECT DISTINCT ON (lower(brand_name))
                  brand_name, profile, created_at
             FROM brand_dna
            WHERE account_id = $1
            ORDER BY lower(brand_name), created_at DESC
         ) t
        ORDER BY created_at DESC
        LIMIT 48`,
      [s.account_id],
    );
    return NextResponse.json({
      brands: rows.map((b) => ({
        brand: b.brand_name,
        category: b.category,
        dna: b.profile,
        created_at: String(b.created_at),
      })),
    });
  } catch {
    return NextResponse.json({ brands: [] });
  }
}
