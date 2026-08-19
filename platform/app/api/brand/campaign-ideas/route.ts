import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient, type BrandCampaignConcept } from '@influencer-intel/shared/llm';
import { tokenize, type LiveProfile } from '@/lib/live-discovery';
import { searchCreatorsInDb } from '@/lib/creator-db-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Pull the liveliest trends we measured from our OWN crawl data (trend_signals,
// filled by the ingestion worker) for this brand's niche, so the campaign model
// anchors to first-party signals instead of guessing purely from the web. Best-
// effort: returns [] if the table is empty/missing, leaving the model on web
// search alone. Prefers category-matched, emerging/growing trends by velocity.
async function loadMeasuredTrends(category: string): Promise<string[]> {
  const tokens = category.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  try {
    const rows = await getBolticClient().query<{
      display_name: string; trend_type: string; phase: string;
      velocity: string; usage_count_7d: number;
    }>(
      `SELECT display_name, trend_type, phase, velocity::text AS velocity, usage_count_7d
         FROM trend_signals
        WHERE phase IN ('emerging','growing','peak')
          ${tokens.length ? 'AND (categories && $1::text[] OR categories IS NULL OR cardinality(categories) = 0)' : ''}
        ORDER BY CASE phase WHEN 'emerging' THEN 0 WHEN 'growing' THEN 1 ELSE 2 END,
                 velocity DESC
        LIMIT 15`,
      tokens.length ? [tokens] : undefined,
    );
    return rows.map((r) => {
      const pct = Math.round(Number(r.velocity) * 100);
      const growth = Number.isFinite(pct) ? `${pct >= 0 ? '+' : ''}${pct}% wk-on-wk` : r.phase;
      return `${r.display_name} — ${r.trend_type}, ${r.phase}, ${growth}, ${Number(r.usage_count_7d) || 0} posts/7d`;
    });
  } catch {
    return [];
  }
}

// POST /api/brand/campaign-ideas
//   { brand, category, audience?, cities?, budget?, goals? }
//   → { brand, campaigns: [{ ...concept, creators: LiveProfile[] }], trends_used }
//
// Powers the brand "Campaign Ideas" feature. We first pull the trends we MEASURED
// from our own crawl data (trend_signals) for this niche and hand them to the
// web-search model as the primary signal — it grounds concepts in those and uses
// live search to confirm/fill gaps. For each concept we run its `creator_query`
// against the creator DB to attach a ready shortlist — so a brand goes
// trend → campaign → creators in one call.
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
  const measuredTrends = await loadMeasuredTrends(category);
  const input = {
    brand,
    category,
    audience: typeof body?.audience === 'string' ? body.audience.trim() : null,
    cities,
    budget: typeof body?.budget === 'string' ? body.budget.trim() : null,
    goals: typeof body?.goals === 'string' ? body.goals.trim() : null,
    measuredTrends,
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

  return NextResponse.json({ brand, campaigns, trends_used: measuredTrends.length });
}
