// DB-first creator lookup. Before crawling Instagram live, we check whether
// the connected `creators` table already has matches for the prompt — these
// come back instantly. A token "matches" when it appears in any of the
// creator's searchable text fields; the score is how many tokens matched.

import { getBolticClient } from '@influencer-intel/shared/db';
import { extractContact, expandStateTokens, isLocationToken, isForeignLocationToken, type LiveProfile } from './live-discovery';

// Searchable text split by field group, so a token's relevance depends on
// WHERE it matched — not just whether it matched. For a campaign brief
// ("summer outfit for goa") a location or niche hit is a far stronger signal
// than a stray substring in someone's bio. Ranking by this weighted relevance
// (instead of by follower count) stops mega-celebrities from burying smaller,
// better-matched creators.
// Role-words that describe WHAT a creator is, not WHICH niche. They recur
// across unrelated verticals ("hair artist", "makeup artist", "tattoo artist"),
// so on their own they qualify almost anyone — a search for "tattoo artist"
// must be anchored by the SPECIFIC term ("tattoo"), with "artist" only adding
// score, never gating a row in. Kept deliberately narrow: real niches
// (photographer, chef, gamer, designer, model…) are NOT listed here.
const GENERIC_NICHE = new Set([
  'artist', 'artists', 'creator', 'creators', 'influencer', 'influencers',
  'blogger', 'bloggers', 'vlogger', 'vloggers', 'content', 'official',
  'page', 'pages', 'account', 'star', 'stars', 'guy', 'guys', 'girl',
  'girls', 'boy', 'boys', 'video', 'videos', 'reel', 'reels', 'daily',
  'world', 'love', 'best', 'top', 'the', 'and', 'for', 'with', 'your', 'you',
  // Weak "container/context" modifiers: they recur across unrelated niches
  // ("home baker", "home decor", "home gardening"; "studio", "shop", "online"),
  // so on their own they'd admit anyone with the word in their handle/niche.
  // Anchor the gate on the SPECIFIC term instead ("baker"), and let these only
  // add to score. Fixes e.g. a "home baker" search pulling in home-gardeners.
  'home', 'homes', 'studio', 'studios', 'shop', 'shops', 'store',
  'stores', 'online', 'india', 'indian', 'life', 'diaries', 'diary',
]);

const LOC_TXT = `lower(coalesce(region,'') || ' ' || coalesce(primary_city,''))`;
const NICHE_TXT = `lower(coalesce(genre,'') || ' ' || coalesce(niche,'') || ' ' || coalesce(primary_category,'') || ' ' || coalesce(array_to_string(tags, ' '), ''))`;
// NICHE_STRICT is NICHE_TXT WITHOUT tags — used for the niche GATE only. The
// discovery crawler blindly tags every find with the search keywords, so a
// Mumbai real-estate account crawled under a "home baker" search ends up tagged
// "baker" and would otherwise pass a "sourdough baker" gate. Gating on the
// genuine classification fields (genre/niche/category) + handle/name keeps that
// noise out. Tags still feed the relevance SCORE (via NICHE_TXT) — they just
// can't admit a row THROUGH the gate on their own.
const NICHE_STRICT = `lower(coalesce(genre,'') || ' ' || coalesce(niche,'') || ' ' || coalesce(primary_category,''))`;
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
  source: string | null;
  gender: string | null;
  is_indian: boolean | null;
  score: number | string;
  loc_match: boolean | null;
}

export async function searchCreatorsInDb(
  tokens: string[],
  limit: number,
  opts: { bucket?: 'instagram' | 'trends'; minFollowers?: number; maxFollowers?: number; minEngagement?: number; gender?: 'female' | 'male'; locationBackfill?: boolean } = {},
): Promise<LiveProfile[]> {
  if (tokens.length === 0) return [];
  // Expand a state ("gujarat") into its cities so a state search ranks creators
  // anywhere in that state (their location field holds a city, not the state).
  tokens = expandStateTokens(tokens);

  // Optional creator-gender filter (labeled during discovery via LLM on
  // handle/name/bio). Only 'female'/'male' are accepted; anything else is inert.
  const genderFilter = opts.gender === 'female' ? "and gender = 'female'"
    : opts.gender === 'male' ? "and gender = 'male'"
    : '';

  const params = tokens.map((t) => `%${t.toLowerCase()}%`);
  const scoreExpr = tokens.map((_, i) => tokenScore(`$${i + 1}`)).join(' + ');
  const whereAny = tokens.map((_, i) => tokenMatches(`$${i + 1}`)).join(' or ');
  // Does any token hit the LOCATION field? When a query names a place
  // ("...in pune"), a creator actually based there must outrank a bigger but
  // non-local account — otherwise reach drags mega-celebs to the top of a local
  // search. Only real place tokens match the location field, so this is inert
  // for queries without a location, and degrades gracefully when the DB has no
  // local creators (everyone is loc_hit=false → falls back to relevance).
  // Location hit: a place token appears in the creator's geo field OR anywhere
  // else in their profile (handle / name / bio / niche). Broadening beyond the
  // geo column catches locals who state their city in bio/handle
  // ("📍Pondicherry", "@pondicherrytravels") but were never geo-tagged — so a
  // location search leads with genuine locals, not global niche mega-creators.
  const locTokenIdx = tokens.map((t, i) => (isLocationToken(t) ? i : -1)).filter((i) => i >= 0);
  const hasLocToken = locTokenIdx.length > 0;
  // Did the user explicitly name a FOREIGN place ("nepal", "dubai", "london")?
  // If so they WANT foreign creators, so the India-first ranking sink below must
  // NOT bury them — a "nepal" search should lead with Nepali (is_indian=false)
  // creators, not push them under every unflagged Indian one.
  const hasForeignLocToken = tokens.some((t) => isForeignLocationToken(t));
  const locHitExpr = hasLocToken
    ? locTokenIdx
        .map((i) => `(${LOC_TXT} like $${i + 1} or ${ID_TXT} like $${i + 1} or ${BIO_TXT} like $${i + 1} or ${NICHE_TXT} like $${i + 1})`)
        .join(' or ')
    : 'false';

  // Location is a RANKING signal, not a hard filter: creators verified in the
  // queried city score higher (LOC_TXT is weighted 3 in tokenScore) and are the
  // loc_match tiebreak, so PERFECT matches (right niche + right city) lead — then
  // niche-relevant creators without a verified location follow below. (We used to
  // hard-require the location, which hid every niche match that wasn't yet
  // geo-tagged; the niche gate below keeps results on-topic instead.)

  // NICHE gate: the non-city terms ("food", "comedy", "fashion") must match the
  // creator's niche fields (category / niche / tags) OR their handle/name — so a
  // location search like "food blogger in pune" returns actual FOOD creators,
  // not every lifestyle/travel creator who happens to be in Pune. A bio-only
  // mention is too weak to qualify. Inert when the query is location-only.
  const nicheIdx = tokens
    .map((t, i) => (isLocationToken(t) ? -1 : i))
    .filter((i) => i >= 0);
  // Anchor the gate on the SPECIFIC niche tokens ("tattoo", "vegan", "saree")
  // and drop the generic role-words ("artist", "creator") from the requirement,
  // so a Pune HAIR artist can't satisfy a "tattoo artist" query just by matching
  // "artist". When the query is *only* generic words we fall back to the full
  // set (something still has to match). Generics keep contributing to `score`.
  const specificIdx = nicheIdx.filter((i) => !GENERIC_NICHE.has((tokens[i] ?? '').toLowerCase()));
  const gateIdx = specificIdx.length ? specificIdx : nicheIdx;
  const nicheRequired = gateIdx.length
    ? `and (${gateIdx.map((i) => `(${NICHE_STRICT} like $${i + 1} or ${ID_TXT} like $${i + 1})`).join(' or ')})`
    : '';

  // Source bucket: the browser scraper's own finds come FIRST, then the
  // creators imported from the Excel sheets. "Excel"/Trends = curated
  // (source 'manual') or the Fynd seeding import (tagged 'fynd-seeding');
  // everything else is a browser-scraper (real Instagram) discovery.
  const EXCEL_EXPR = `(coalesce(source, '') = 'manual' or 'fynd-seeding' = any(coalesce(tags, '{}')))`;
  const SOURCE_BUCKET = `case when ${EXCEL_EXPR} then 1 else 0 end`;

  // Toggle: 'instagram' → only the scraper's real-IG finds; 'trends' → only the
  // uploaded Excel/campaign creators. Undefined → both (scraper first).
  const bucketFilter =
    opts.bucket === 'instagram' ? `and not ${EXCEL_EXPR}`
    : opts.bucket === 'trends' ? `and ${EXCEL_EXPR}`
    : '';

  // Follower floor (default 0). The Lander passes 5000 so sub-5K nanos and
  // bad-scrape anomalies (e.g. a mega read as 41 followers) drop out; unknown
  // counts are kept so freshly-discovered stubs still surface.
  const floor = Number(opts.minFollowers) > 0
    ? `and (follower_count is null or follower_count >= ${Math.floor(Number(opts.minFollowers))})`
    : '';

  // Brief band: a follower ceiling and/or ER floor parsed from a typed brief
  // ("5k-20k followers, 4%+ ER"). Applied server-side so the limited result
  // slots go to creators that actually FIT the band — otherwise the DB returns
  // out-of-band creators that the client filters away, starving "load more".
  // NULLs are KEPT (same convention as the floor above): freshly-discovered
  // stubs with unknown stats still surface and get enriched later. ER is stored
  // as a ratio (0.04), so a 4%-brief compares against 0.04.
  const ceil = Number(opts.maxFollowers) > 0
    ? `and (follower_count is null or follower_count <= ${Math.floor(Number(opts.maxFollowers))})`
    : '';
  const erFloor = Number(opts.minEngagement) > 0
    ? `and (engagement_rate is null or engagement_rate >= ${Number(opts.minEngagement) / 100})`
    : '';

  // Conditional LOCATION filter (only when the query names a place). Ranking
  // alone isn't enough: when a query's genuine locals get claimed by the AI/live
  // sections upstream (they're de-duped out of the DB section), the DB fallback
  // is left showing the non-local tail — e.g. "dance creator for guwahati"
  // surfacing Madhuri Dixit / national dance celebs who only match "dance". So
  // when the query has a place token AND at least one local match exists
  // (loc_total > 0), drop the non-locals entirely. When NO local matches exist
  // we fall back to the full niche-relevant set (loc_total = 0 short-circuits the
  // filter) — preserving the "never hide the only matches we have" behavior for
  // cities the DB hasn't covered yet.
  //
  // `locationBackfill` (the brand/lander finder) OPTS OUT of the hard drop: a
  // narrow niche+city brief ("tech reviewers in Mumbai") otherwise returns only
  // the 2-3 creators geo-tagged to that exact city, starving the page. With
  // backfill on we keep the non-local niche matches too — still ranked BELOW
  // genuine locals (via `loc_match desc`) and under the caller's limit — so
  // locals lead but the page fills out with relevant creators instead of ~3.
  const localsOnly = hasLocToken && !opts.locationBackfill ? `where (loc_match or loc_total = 0)` : '';

  const sql = `
    with base as (
      select id, handle, display_name, bio, primary_category, follower_count,
             -- engagement_rate is frequently NULL even when recent_posts exist (the
             -- worker stores posts but not the rollup). Compute the ratio from those
             -- posts IN SQL — same math the drawer uses — so rows show a real ER%
             -- instead of "—". The WHERE erFloor filter still sees the raw column.
             coalesce(
               engagement_rate,
               case when json_typeof(recent_posts) = 'array' then (
                 select avg(coalesce((e->>'likes')::numeric, 0) + coalesce((e->>'comments')::numeric, 0))
                   from json_array_elements(recent_posts) e
               ) end / nullif(follower_count, 0)
             ) as engagement_rate,
             is_verified, profile_photo_url, source, gender, is_indian,
             (${scoreExpr}) as score,
             (${locHitExpr}) as loc_match,
             (${SOURCE_BUCKET}) as source_bucket
      from creators
      where platform = 'instagram' and is_active = true and (${whereAny})
        ${nicheRequired}
        ${bucketFilter}
        ${floor}
        ${ceil}
        ${erFloor}
        ${genderFilter}
    ),
    scored as (
      select *, sum(case when loc_match then 1 else 0 end) over () as loc_total
      from base
    )
    select id, handle, display_name, bio, primary_category, follower_count,
           engagement_rate, is_verified, profile_photo_url, source, gender, is_indian,
           score, loc_match
    from scored
    ${localsOnly}
    -- Bucket first (scraper finds before Excel imports). Then INDIA-FIRST: this is
    -- an India-only platform, so foreign creators (is_indian=false) sink below all
    -- Indian/unflagged ones — a broad token like "artisan" no longer leads with a
    -- French charcuterie or an Australian craft page. (Ranked, not filtered:
    -- is_indian is only ~half-populated, so a hard filter would also hide genuine
    -- Indian creators not yet flagged; sinking only the KNOWN-foreign is safe.)
    -- Then LOCALS LEAD when the query names a place, weighted relevance, then reach.
    -- The India-first sink is SKIPPED when the query explicitly names a foreign
    -- place (hasForeignLocToken) — a "nepal"/"dubai" search must surface those
    -- foreign creators, not bury them under every unflagged Indian one.
    order by source_bucket asc,
             ${hasForeignLocToken ? '' : `(case when is_indian = false then 1 else 0 end) asc,`}
             ${hasLocToken ? `loc_match desc,` : ''}
             score desc,
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
      curated: r.source === 'manual',
      gender: (r.gender === 'female' || r.gender === 'male' ? r.gender : null) as 'female' | 'male' | null,
      // false = known-foreign (sinks in ranking); true/undefined = Indian or not-yet-classified
      is_indian: r.is_indian === false ? false : true,
      };
    })
    .filter((p) => p.username && p.score > 0);
}
