import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient, type BrandCampaignConcept } from '@influencer-intel/shared/llm';
import { tokenize, type LiveProfile } from '@/lib/live-discovery';
import { searchCreatorsInDb } from '@/lib/creator-db-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/brand/campaign-ideas
//   { brand, category, audience?, cities?, budget?, goals? }
//   → { brand, campaigns: [{ ...concept, creators: LiveProfile[] }] }
//
// Powers the brand "Campaign Ideas" feature. The web-search model browses for
// what's trending in the brand's niche RIGHT NOW and drafts campaign concepts;
// for each concept we run its `creator_query` against the creator DB to attach a
// ready shortlist — so a brand goes trend → campaign → creators in one call.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const brand = typeof body?.brand === 'string' ? body.brand.trim() : '';
  const category = typeof body?.category === 'string' ? body.category.trim() : '';
  if (brand.length < 2 || category.length < 2) {
    return NextResponse.json(
      { error: 'brand and category are required (min 2 characters each)' },
      { status: 400 },
    );
  }

  const cities = Array.isArray(body?.cities)
    ? body.cities.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0).map((c: string) => c.trim())
    : [];
  const input = {
    brand,
    category,
    audience: typeof body?.audience === 'string' ? body.audience.trim() : null,
    cities,
    budget: typeof body?.budget === 'string' ? body.budget.trim() : null,
    goals: typeof body?.goals === 'string' ? body.goals.trim() : null,
  };

  let concepts: BrandCampaignConcept[] = [];
  try {
    concepts = await getOpenAIClient().suggestBrandCampaigns(input, 4);
  } catch (err) {
    console.error('[brand/campaign-ideas] generation failed:', err);
    return NextResponse.json({ error: 'Could not generate campaign ideas. Try again.' }, { status: 502 });
  }

  // For each concept, shortlist creators from the DB using its creator_query
  // (falling back to the brand category + cities so we always search something).
  const campaigns = await Promise.all(
    concepts.map(async (c) => {
      const query = [c.creator_query || category, cities.join(' ')].filter(Boolean).join(' ');
      const tokens = tokenize(query);
      let creators: LiveProfile[] = [];
      try {
        creators = await searchCreatorsInDb(tokens, 8);
      } catch (err) {
        console.error('[brand/campaign-ideas] creator shortlist failed:', err);
      }
      return { ...c, creators };
    }),
  );

  return NextResponse.json({ brand, campaigns });
}
