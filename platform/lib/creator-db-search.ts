// DB-first creator lookup. Before crawling Instagram live, we check whether
// the connected `creators` table already has matches for the prompt — these
// come back instantly. A token "matches" when it appears in any of the
// creator's searchable text fields; the score is how many tokens matched.

import { getBolticClient } from '@influencer-intel/shared/db';
import type { LiveProfile } from './live-discovery';

// Concatenated, lower-cased searchable text for a creator row.
const SEARCH_TEXT = `lower(
  coalesce(handle,'') || ' ' || coalesce(display_name,'') || ' ' ||
  coalesce(bio,'') || ' ' || coalesce(primary_category,'') || ' ' ||
  coalesce(genre,'') || ' ' || coalesce(niche,'') || ' ' ||
  coalesce(region,'') || ' ' || coalesce(primary_city,'')
)`;

interface Row {
  handle: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  follower_count: number | string | null;
  is_verified: boolean | null;
  profile_photo_url: string | null;
  score: number | string;
}

export async function searchCreatorsInDb(
  tokens: string[],
  limit: number,
): Promise<LiveProfile[]> {
  if (tokens.length === 0) return [];

  const params = tokens.map((t) => `%${t.toLowerCase()}%`);
  const scoreExpr = tokens
    .map((_, i) => `(case when ${SEARCH_TEXT} like $${i + 1} then 1 else 0 end)`)
    .join(' + ');
  const whereAny = tokens.map((_, i) => `${SEARCH_TEXT} like $${i + 1}`).join(' or ');

  const sql = `
    select handle, display_name, bio, primary_category, follower_count,
           is_verified, profile_photo_url, (${scoreExpr}) as score
    from creators
    where platform = 'instagram' and is_active = true and (${whereAny})
    order by score desc, follower_count desc nulls last
    limit $${tokens.length + 1}
  `;

  let rows: Row[];
  try {
    rows = await getBolticClient().query<Row>(sql, [...params, limit]);
  } catch {
    return []; // DB unreachable → caller falls back to live crawl
  }

  // pg returns BIGINT/computed columns as strings — coerce before use.
  return rows
    .map((r) => ({
      username: r.handle,
      full_name: r.display_name ?? '',
      biography: r.bio ?? '',
      category: r.primary_category ?? '',
      followers: Number(r.follower_count ?? 0),
      is_private: false,
      is_verified: Boolean(r.is_verified),
      profile_pic_url: r.profile_photo_url ?? null,
      score: Number(r.score),
      from: 'db' as const,
    }))
    .filter((p) => p.username && p.score > 0);
}
