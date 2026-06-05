// ============================================================
// Competitor analysis — derives "which creators work with brand X" from the
// structured brand mentions our vision pipeline detected on each profile,
// then computes overlap and share of voice between two brands.
//
// We match against the curated `raw_metadata.vision.brand_mentions[]` array
// (real brand names the vision model extracted), NOT a raw-text scan — that
// avoids false positives like "Mars" hitting "smart". `verified` reflects a
// detected paid-partnership tag on the profile.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

export interface BrandCreator {
  id: string;
  handle: string;
  display_name: string | null;
  profile_url: string;
  follower_count: number | string | null;
  primary_category: string | null;
  quality_score: number | string | null;
  verified: boolean;
}

async function findBrandCreators(brand: string): Promise<BrandCreator[]> {
  const db = getBolticClient();
  const name = brand.trim();
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // word-boundary regex against each brand mention
  return db.query<BrandCreator>(
    `SELECT c.id, c.handle, c.display_name, c.profile_url, c.follower_count, c.primary_category, c.quality_score,
            COALESCE((c.raw_metadata->'vision'->>'has_paid_partnership') = 'true', false) AS verified
     FROM creators c
     WHERE c.is_active = true
       AND jsonb_typeof(c.raw_metadata->'vision'->'brand_mentions') = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(c.raw_metadata->'vision'->'brand_mentions') bm(mention)
         WHERE lower(bm.mention) = lower($1) OR lower(bm.mention) ~ ('\\y' || $2 || '\\y')
       )
     ORDER BY verified DESC, c.follower_count DESC NULLS LAST
     LIMIT 60`,
    [name, safe],
  );
}

export async function getCompetitorAnalysis(
  a: string,
  b?: string | null,
): Promise<{
  a: string;
  b: string | null;
  a_creators: BrandCreator[];
  b_creators: BrandCreator[];
  overlap: BrandCreator[];
}> {
  const a_creators = a.trim() ? await findBrandCreators(a) : [];
  const b_creators = b && b.trim() ? await findBrandCreators(b) : [];
  const bIds = new Set(b_creators.map((c) => c.id));
  const overlap = a_creators.filter((c) => bIds.has(c.id));
  return { a, b: b ?? null, a_creators, b_creators, overlap };
}
