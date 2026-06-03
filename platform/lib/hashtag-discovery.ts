// ============================================================
// Build IG-search queries from a brief. These become `search_query`
// scrape jobs which hit IG's own topsearch endpoint and harvest
// real, IG-ranked users for the query.
//
// Primary path: gpt-4o-mini generates 12-15 diverse natural-language
// queries tailored to the specific brief (raw text + parsed spec).
// Fallback: hand-tuned category templates if LLM fails or times out.
// ============================================================

import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { Brief } from '@influencer-intel/shared/types';

const CATEGORY_QUERIES: Record<string, string[]> = {
  fashion: ['indian fashion', 'fashion blogger', 'style influencer india', 'ootd india'],
  beauty: ['indian beauty', 'beauty blogger india', 'makeup artist india', 'clean beauty india'],
  skincare: ['skincare india', 'skin influencer', 'glowing skin india', 'skincare tips india'],
  food: ['indian food blogger', 'foodie india', 'home cooking india', 'street food india'],
  travel: ['travel india', 'indian traveller', 'wanderlust india', 'budget travel india'],
  fitness: ['fitness india', 'workout india', 'yoga teacher india', 'indian gym girl'],
  lifestyle: ['indian lifestyle', 'lifestyle blogger india', 'mumbai lifestyle', 'delhi creator'],
  home: ['home decor india', 'interior india', 'desi home decor', 'indian home tour'],
  wellness: ['wellness india', 'yoga india', 'mindfulness india', 'ayurveda creator'],
  tech: ['tech india', 'gadget reviewer india', 'tech reviewer hindi', 'indian techie'],
  other: ['india creator', 'indian content creator'],
};

const CAMPAIGN_QUERY_HINTS: Record<string, string[]> = {
  festive: ['diwali fashion', 'ethnic wear india', 'festive look', 'diwali outfit'],
  brand_launch: ['indian creator', 'product launch'],
  important_days: ['women india', 'mothers day india', 'rakshabandhan'],
  travel: ['india travel'],
};

/**
 * Generate diverse search queries for a brief. Asynchronous — uses LLM
 * primarily, with a hand-tuned template fallback that still returns
 * 5-10 queries if the LLM call fails.
 */
export async function buildHashtagQueries(brief: Brief): Promise<string[]> {
  const spec = brief.parsed_spec;
  if (!spec) return [];

  // Try LLM-generated queries first — these are tailored to the specific
  // brief, including the raw text, and produce 12-15 distinct queries.
  try {
    const llm = getOpenAIClient();
    const queries = await llm.generateDiscoveryQueries({
      category: spec.category,
      campaign_type: spec.campaign_type,
      target_gender: spec.target_gender,
      target_age_min: spec.target_age_min,
      target_age_max: spec.target_age_max,
      target_cities: spec.target_cities ?? [],
      target_languages: spec.target_languages ?? [],
      vibe: spec.vibe,
      raw_text: brief.raw_text,
    });
    if (queries.length >= 5) {
      // Cap at 15 to bound scraper load per brief (~6 min at 25s/query).
      return Array.from(new Set(queries)).slice(0, 15);
    }
  } catch (err) {
    console.warn('[hashtag-discovery] LLM query generation failed, falling back:', (err as Error).message);
  }

  // Fallback: hand-tuned templates.
  const queries = new Set<string>();
  const cat = spec.category ?? 'other';
  for (const q of CATEGORY_QUERIES[cat] ?? CATEGORY_QUERIES.other!) queries.add(q);
  if (spec.campaign_type) {
    for (const q of CAMPAIGN_QUERY_HINTS[spec.campaign_type] ?? []) queries.add(q);
  }
  for (const city of (spec.target_cities ?? []).slice(0, 3)) {
    queries.add(`${city.toLowerCase()} ${cat}`);
    queries.add(`${city.toLowerCase()} influencer`);
  }
  return Array.from(queries).slice(0, 12);
}
