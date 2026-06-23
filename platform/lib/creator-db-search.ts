// DB-first creator lookup. Before crawling Instagram live, we check whether
// the connected `creators` table already has matches for the prompt — these
// come back instantly. A token "matches" when it appears in any of the
// creator's searchable text fields; the score is how many tokens matched.

import { getBolticClient } from '@influencer-intel/shared/db';
import { extractContact, type LiveProfile } from './live-discovery';

// Searchable text split by field group, so a token's relevance depends on
// WHERE it matched — not just whether it matched. For a campaign brief
// ("summer outfit for goa") a location or niche hit is a far stronger signal
// than a stray substring in someone's bio. Ranking by this weighted relevance
// (instead of by follower count) stops mega-celebrities from burying smaller,
// better-matched creators.
const LOC_TXT = `lower(coalesce(region,'') || ' ' || coalesce(primary_city,''))`;
const NICHE_TXT = `lower(coalesce(genre,'') || ' ' || coalesce(niche,'') || ' ' || coalesce(primary_category,'') || ' ' || coalesce(array_to_string(tags, ' '), ''))`;
const ID_TXT = `lower(coalesce(handle,'') || ' ' || coalesce(display_name,''))`;
const BIO_TXT = `lower(coalesce(bio,''))`;

// A token scores at its best-matching field's weight (location 3, niche/name 2,
// bio 1) so matching the same token in multiple fields isn't double-counted.
function tokenScore(placeholder: string): string {
  return `greatest(
    case when ${LOC_TXT} like ${placeholder} then 3 else 0 end,
    case when ${NICHE_TXT} like ${placeholder} then 2 else 0 end,
    case when ${ID_TXT} like ${placeholder} then 2 else 0 end,
    case when ${BIO_TXT} like ${placeholder} then 1 else 0 end
  )`;
}
function tokenMatches(placeholder: string): string {
  return `(${LOC_TXT} like ${placeholder} or ${NICHE_TXT} like ${placeholder} or ${ID_TXT} like ${placeholder} or ${BIO_TXT} like ${placeholder})`;
}

interface Row {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  is_verified: boolean | null;
  profile_photo_url: string | null;
  score: number | string;
  loc_match: boolean | null;
}

export async function searchCreatorsInDb(
  tokens: string[],
  limit: number,
): Promise<LiveProfile[]> {
  if (tokens.length === 0) return [];

  const params = tokens.map((t) => `%${t.toLowerCase()}%`);
  const scoreExpr = tokens.map((_, i) => tokenScore(`$${i + 1}`)).join(' + ');
  const whereAny = tokens.map((_, i) => tokenMatches(`$${i + 1}`)).join(' or ');
  // Does any token hit the LOCATION field? When a query names a place
  // ("...in pune"), a creator actually based there must outrank a bigger but
  // non-local account — otherwise reach drags mega-celebs to the top of a local
  // search. Only real place tokens match the location field, so this is inert
  // for queries without a location, and degrades gracefully when the DB has no
  // local creators (everyone is loc_hit=false → falls back to relevance).
  const locExpr = tokens.map((_, i) => `${LOC_TXT} like $${i + 1}`).join(' or ');

  const sql = `
    select id, handle, display_name, bio, primary_category, follower_count,
           engagement_rate, is_verified, profile_photo_url,
           (${scoreExpr}) as score, (${locExpr}) as loc_match
    from creators
    where platform = 'instagram' and is_active = true and (${whereAny})
    -- Location match first (honour "in <place>"), then weighted relevance, then
    -- the user's own curated/imported list (source='manual'), reach last.
    order by (${locExpr}) desc,
             score desc,
             coalesce(source = 'manual', false) desc,
             follower_count desc nulls last
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
    .map((r) => {
      const contact = extractContact(r.bio);
      return {
      username: r.handle,
      full_name: r.display_name ?? '',
      biography: r.bio ?? '',
      category: r.primary_category ?? '',
      followers: Number(r.follower_count ?? 0),
      is_private: false,
      is_verified: Boolean(r.is_verified),
      profile_pic_url: r.profile_photo_url ?? null,
      score: Number(r.score),
      // engagement_rate is stored as a ratio (0.04) → show as 4.0%
      engagement: r.engagement_rate != null ? Math.round(Number(r.engagement_rate) * 1000) / 10 : 0,
      email: contact.email,
      phone: contact.phone,
      link: contact.link,
      creator_id: r.id,
      from: 'db' as const,
      loc_match: Boolean(r.loc_match),
      };
    })
    .filter((p) => p.username && p.score > 0);
}
