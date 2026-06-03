// ============================================================
// Reasoning — generates the per-creator "Why ranked here"
// explanation shown in the right-hand panel.
// ============================================================

import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { Brief } from '@influencer-intel/shared/types';
import type { RankedCreator } from './ranker';

export async function generatePerCreatorReasoning(
  brief: Brief,
  ranked: RankedCreator,
  rank: number,
): Promise<string> {
  const llm = getOpenAIClient();
  const spec = brief.parsed_spec;
  const briefSummary = [
    spec?.category ?? 'general',
    spec?.target_gender ?? 'all',
    `${spec?.target_age_min ?? '?'}-${spec?.target_age_max ?? '?'}`,
    (spec?.target_cities ?? []).join('/') || 'pan-India',
    spec?.vibe ?? '',
  ]
    .filter(Boolean)
    .join(', ');

  const cred = ranked.creator.credibility;
  const creatorSummary = [
    `@${ranked.creator.handle}`,
    ranked.creator.display_name ?? '',
    ranked.creator.primary_city ?? '',
    ranked.creator.follower_count ? `${ranked.creator.follower_count} followers` : '',
    ranked.creator.engagement_rate ? `ER ${(ranked.creator.engagement_rate * 100).toFixed(2)}%` : '',
    cred ? `credibility ${cred.overall_score}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return llm.generateReasoning({
    brief_summary: briefSummary,
    creator_summary: creatorSummary,
    rank,
    match_signals: ranked.signals,
  });
}

/** Heuristic, no-LLM fallback (used in shortlist-service for fast first paint). */
export function generateLightReasoning(ranked: RankedCreator, rank: number): string {
  return [
    `Ranked #${rank} (match score ${ranked.match_score}%)`,
    ...ranked.signals.map((s) => `· ${s}`),
  ].join('\n');
}
