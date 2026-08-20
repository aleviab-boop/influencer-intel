// Building the "Creators who fit {brand}" list, shared by the brand-DNA route
// (fresh analysis) and the lazy-load collaborators route (a returning brand that
// already has DNA). Two-part sourcing:
//   1. AI web-search for creators who've worked with the brand / its product
//      niche, grounded in what the brand makes (from its DNA), seeded with the
//      handles the brand tags in its own IG posts.
//   2. A blend of REAL, enriched creators from our own DB matched to the brand's
//      product niche — so the list always shows genuine creators (photo + reach)
//      even when the web search is thin or the IG relay is down.
// The AI handles come first (they're the closest to true collaborators), DB
// niche creators fill the rest, de-duped by handle.

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient, type BrandDnaProfile } from '@influencer-intel/shared/llm';
import { tokenize } from './live-discovery';
import { searchCreatorsInDb } from './creator-db-search';

export interface Collaborator {
  username: string;
  full_name: string;
  followers: number;
  engagement: number;
  profile_pic_url: string | null;
  in_db: boolean;
}

const CAP = 12;

// Enrich a list of collaborator handles from the creators table (photo, reach,
// ER) so the workspace can render real cards. Handles not in the DB still come
// back with a minimal shell so the brand can still open them on Instagram.
export async function enrichCollaborators(handles: string[]): Promise<Collaborator[]> {
  if (handles.length === 0) return [];
  const lower = handles.map((h) => h.toLowerCase());
  let rows: Array<{
    handle: string;
    display_name: string | null;
    follower_count: number | string | null;
    engagement_rate: number | string | null;
    profile_photo_url: string | null;
  }> = [];
  try {
    rows = await getBolticClient().query(
      `SELECT handle, display_name, follower_count, engagement_rate, profile_photo_url
         FROM creators
        WHERE platform = 'instagram' AND lower(handle) = ANY($1)`,
      [lower],
    );
  } catch {
    rows = [];
  }
  const byHandle = new Map(rows.map((r) => [r.handle.toLowerCase(), r]));
  return handles.map((h) => {
    const r = byHandle.get(h.toLowerCase());
    return {
      username: h,
      full_name: r?.display_name ?? '',
      followers: Number(r?.follower_count ?? 0),
      engagement: r?.engagement_rate != null ? Math.round(Number(r.engagement_rate) * 1000) / 10 : 0,
      profile_pic_url: r?.profile_photo_url ?? null,
      in_db: Boolean(r),
    };
  });
}

// Build the full collaborator list for a brand from its DNA + first-party IG
// mentions. Never throws — returns whatever it could assemble (possibly []).
export async function buildBrandCollaborators(
  brand: string,
  dna: BrandDnaProfile,
  opts: { seedHandles?: string[]; igCategory?: string | null } = {},
): Promise<Collaborator[]> {
  const products = [
    dna.summary,
    dna.category,
    ...(dna.content_pillars ?? []),
    ...(dna.keywords ?? []),
  ]
    .filter(Boolean)
    .join('; ')
    .slice(0, 400);

  let collaborators: Collaborator[] = [];

  // 1) AI-sourced collaborators (grounded on what the brand makes).
  try {
    const handles = await getOpenAIClient().suggestBrandCollaborators(brand, {
      category: dna.category || opts.igCategory || undefined,
      products: products || undefined,
      seedHandles: opts.seedHandles ?? [],
    });
    collaborators = await enrichCollaborators(handles);
  } catch {
    // Fall back to the raw first-party mentions if the AI step fails.
    if (opts.seedHandles?.length) {
      collaborators = await enrichCollaborators(opts.seedHandles);
    }
  }

  // 2) Blend in real DB creators matched to the brand's product niche.
  try {
    const nicheQuery = [dna.category, ...(dna.creator_archetypes ?? []), ...(dna.keywords ?? [])]
      .filter(Boolean)
      .join(' ');
    const tokens = tokenize(nicheQuery);
    if (tokens.length) {
      const dbCreators = await searchCreatorsInDb(tokens, CAP, { bucket: 'instagram', minFollowers: 3000 });
      const seen = new Set(collaborators.map((c) => c.username.toLowerCase()));
      for (const p of dbCreators) {
        const k = p.username.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        collaborators.push({
          username: p.username,
          full_name: p.full_name ?? '',
          followers: p.followers ?? 0,
          engagement: typeof p.engagement === 'number' ? p.engagement : 0,
          profile_pic_url: p.profile_pic_url ?? null,
          in_db: true,
        });
        if (collaborators.length >= CAP) break;
      }
    }
  } catch {
    /* DB blend is a best-effort backbone */
  }

  return collaborators.slice(0, CAP);
}
