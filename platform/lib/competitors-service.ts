// ============================================================
// Competitor analysis — derives "which creators work with brand X" from the
// brand mentions in our scraped data (bio + vision metadata + post captions),
// then computes overlap and share of voice between two brands.
//
// Heuristic: word-boundary, case-insensitive match of the brand name across
// the creator's text. Not a definitive partnership graph, but real signal
// from real data.
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
}

async function findBrandCreators(brand: string): Promise<BrandCreator[]> {
  const db = getBolticClient();
  const safe = brand.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = `\\y${safe}\\y`; // word-boundary, case-insensitive (~*)
  return db.query<BrandCreator>(
    `SELECT id, handle, display_name, profile_url, follower_count, primary_category, quality_score
     FROM creators
     WHERE is_active = true
       AND (COALESCE(bio,'') || ' ' || COALESCE(raw_metadata::text,'') || ' ' || COALESCE(recent_posts::text,'')) ~* $1
     ORDER BY follower_count DESC NULLS LAST
     LIMIT 60`,
    [re],
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
