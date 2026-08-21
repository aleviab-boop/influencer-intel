import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient, type BrandCampaignConcept, type BrandDnaProfile } from '@influencer-intel/shared/llm';
import { tokenize, type LiveProfile } from '@/lib/live-discovery';
import { searchCreatorsInDb } from '@/lib/creator-db-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Load the latest saved Brand DNA for this brand (case-insensitive). Lets the
// campaign step reuse an earlier analysis — filling category/audience gaps and
// keeping concepts on-brand — even when called directly, not just via the
// workspace hand-off. Best-effort: null if none saved / table missing.
async function loadSavedDna(brand: string): Promise<BrandDnaProfile | null> {
  try {
    const rows = await getBolticClient().query<{ profile: BrandDnaProfile }>(
      `SELECT profile FROM brand_dna WHERE lower(brand_name) = lower($1)
        ORDER BY created_at DESC LIMIT 1`,
      [brand],
    );
    return rows[0]?.profile ?? null;
  } catch {
    return null;
  }
}

// Condense a DNA profile into a compact, promptable brief the campaign model
// can stay on-brand with.
function dnaToContext(dna: BrandDnaProfile): string {
  const line = (label: string, v: string) => (v ? `${label}: ${v}` : '');
  const list = (label: string, a: string[]) => (a?.length ? `${label}: ${a.slice(0, 6).join(', ')}` : '');
  return [
    line('Summary', dna.summary),
    line('Positioning', dna.positioning),
    list('Values', dna.values),
    list('Personality', dna.personality),
    list('Content pillars', dna.content_pillars),
    list('Fitting creators', dna.creator_archetypes),
  ]
    .filter(Boolean)
    .join('\n');
}

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
//   { brand, category?, audience?, cities?, budget?, goals? }
//   → { brand, campaigns: [{ ...concept, creators }], trends_used, dna_used }
//
// Powers the brand "Campaign Ideas" feature. We reuse the brand's saved DNA
// (category/audience gaps + on-brand context) AND the trends we MEASURED from our
// own crawl data (trend_signals), handing both to the web-search model — it
// grounds concepts in those and uses live search to confirm/fill gaps. `category`
// is optional when a DNA analysis exists for the brand. For each concept we run
// its `creator_query` against the creator DB to attach a ready shortlist — so a
// brand goes DNA → trend → campaign → creators in one call.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const brand = typeof body?.brand === 'string' ? body.brand.trim() : '';
  if (brand.length < 2) {
    return NextResponse.json({ error: 'brand is required (min 2 characters)' }, { status: 400 });
  }

  // Pull any saved Brand DNA so we can fill gaps + keep concepts on-brand.
  const dna = await loadSavedDna(brand);
  const category = (typeof body?.category === 'string' && body.category.trim()) || dna?.category || '';
  if (category.length < 2) {
    return NextResponse.json(
      { error: 'category is required (min 2 characters) — or analyse the brand DNA first' },
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
    audience: (typeof body?.audience === 'string' && body.audience.trim()) || dna?.target_audience || null,
    cities,
    budget: typeof body?.budget === 'string' ? body.budget.trim() : null,
    goals: typeof body?.goals === 'string' ? body.goals.trim() : null,
    measuredTrends,
    brandContext: dna ? dnaToContext(dna) : null,
  };

  let concepts: BrandCampaignConcept[] = [];
  try {
    concepts = await getOpenAIClient().suggestBrandCampaigns(input, 6);
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

  return NextResponse.json({ brand, campaigns, trends_used: measuredTrends.length, dna_used: !!dna });
}
