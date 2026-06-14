import { getBolticClient } from '@influencer-intel/shared/db';

export interface ScoredCreator {
  id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | null;
  engagement_rate: number | null;
  primary_category: string | null;
  primary_city: string | null;
  bio: string | null;
  city_tier: string | null;
  is_verified: boolean;
  cred_score: string | null;
  cred_badge: string | null;
  has_paid_partnership: boolean;
  audience_pct_in_city: number;
  relevance_score: number;
}

// Rank creators for a store's region by city/state/audience match + credibility.
// Shared by the store-influencers and store-suggest API routes.
export async function findInfluencersForRegion(
  db: ReturnType<typeof getBolticClient>,
  city: string,
  state: string | null,
  storeCityTier: string | null,
  category?: string,
  limit = 50,
): Promise<ScoredCreator[]> {
  const cityLower = city.toLowerCase();
  const stateLower = state?.toLowerCase() ?? '';

  // Fetch candidates: primary_city match, bio match, or audience top_cities match
  const params: unknown[] = [`%${cityLower}%`];
  const conditions = [
    `LOWER(primary_city) LIKE $1`,
    `LOWER(bio) LIKE $1`,
    `audience_demographics::text ILIKE $1`,
  ];
  if (stateLower) {
    params.push(`%${stateLower}%`);
    conditions.push(`LOWER(bio) LIKE $${params.length}`);
  }

  let categoryFilter = '';
  if (category) {
    params.push(category.toLowerCase());
    categoryFilter = ` AND LOWER(primary_category) = $${params.length}`;
  }

  const candidates = await db.query<Record<string, unknown>>(
    `SELECT id, handle, display_name, profile_photo_url,
            follower_count, engagement_rate, primary_category,
            primary_city, city_tier, bio, is_verified,
            audience_demographics,
            credibility->>'overall_score' AS cred_score,
            credibility->>'badge' AS cred_badge,
            raw_metadata->'vision'->>'has_paid_partnership' AS has_paid_partnership_str
     FROM creators
     WHERE is_active = true
       AND (${conditions.join(' OR ')})
       ${categoryFilter}
     ORDER BY follower_count DESC NULLS LAST
     LIMIT 200`,
    params,
  );

  // Score each candidate
  const scored: ScoredCreator[] = candidates.map((c) => {
    let score = 0;
    let audiencePct = 0;

    // primary_city match: +40
    const pCity = ((c.primary_city as string) ?? '').toLowerCase();
    if (pCity.includes(cityLower)) score += 40;

    // audience_demographics top_cities match: weighted by pct
    const demographics = c.audience_demographics as { top_cities?: { city: string; pct: number }[] } | null;
    if (demographics?.top_cities) {
      for (const tc of demographics.top_cities) {
        if (tc.city.toLowerCase().includes(cityLower)) {
          score += Math.round(tc.pct * 30);
          audiencePct = Math.max(audiencePct, tc.pct);
        }
      }
    }

    // bio contains city or state: +10
    const bio = ((c.bio as string) ?? '').toLowerCase();
    if (bio.includes(cityLower) || (stateLower && bio.includes(stateLower))) {
      score += 10;
    }

    // city_tier match: +10
    if (storeCityTier && c.city_tier === storeCityTier) score += 10;

    // has_paid_partnership: +5
    const hasPaid = c.has_paid_partnership_str === 'true';
    if (hasPaid) score += 5;

    return {
      id: c.id as string,
      handle: c.handle as string,
      display_name: c.display_name as string | null,
      profile_photo_url: c.profile_photo_url as string | null,
      follower_count: c.follower_count as number | null,
      engagement_rate: c.engagement_rate as number | null,
      primary_category: c.primary_category as string | null,
      primary_city: c.primary_city as string | null,
      bio: c.bio as string | null,
      city_tier: c.city_tier as string | null,
      is_verified: c.is_verified as boolean,
      cred_score: c.cred_score as string | null,
      cred_badge: c.cred_badge as string | null,
      has_paid_partnership: hasPaid,
      audience_pct_in_city: Math.round(audiencePct * 100) / 100,
      relevance_score: score,
    };
  });

  // Sort by score descending, then by followers
  scored.sort((a, b) => {
    if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
    return (b.follower_count ?? 0) - (a.follower_count ?? 0);
  });

  return scored.slice(0, limit);
}
