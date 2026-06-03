// ============================================================
// Candidate discovery — given a brief, returns ~50–100 candidate
// creators bucketed by cache freshness.
//
// We rely on embedding similarity for ranking; SQL filters are
// permissive (don't exclude creators with NULL metadata).
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { Brief, Creator } from '@influencer-intel/shared/types';

export interface CandidateBucket {
  fresh: Creator[];
  stale: Creator[];
  miss: { handle: string }[];
}

export async function discoverCandidates(brief: Brief): Promise<CandidateBucket> {
  // Source: vector search over our existing creators directory. Real discovery
  // (new handles not yet in DB) happens via the IG search_query job pipeline,
  // not via LLM-hallucinated handles — so we no longer mix in `generateLLMCandidates`
  // here. That source produced too many fake handles that just timed out.
  const fromDirectory = await searchDirectory(brief);

  const fresh: Creator[] = [];
  const stale: Creator[] = [];
  const miss: { handle: string }[] = [];

  const now = Date.now();
  const USABLE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — still usable for shortlisting
  const REFRESH_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — queue background refresh

  for (const creator of fromDirectory) {
    if (!creator.last_scraped_at) {
      miss.push({ handle: creator.handle.toLowerCase() });
      continue;
    }
    const ageMs = now - new Date(creator.last_scraped_at).getTime();
    // Treat all creators scraped within 90 days as "fresh" for shortlisting.
    // Their data is good enough to rank and show. Queue a background refresh
    // for ones older than 14 days, but don't block the shortlist on it.
    if (ageMs < USABLE_MS) {
      fresh.push(creator);
      if (ageMs >= REFRESH_MS) stale.push(creator); // also queue refresh
    } else {
      miss.push({ handle: creator.handle.toLowerCase() });
    }
  }

  return { fresh, stale, miss };
}

async function searchDirectory(brief: Brief): Promise<Creator[]> {
  const db = getBolticClient();
  if (!brief.brief_embedding) return [];

  // Soft filter: only require is_active. We deliberately do NOT filter by
  // primary_category / primary_city / content_languages here because most
  // freshly-scraped creators have those fields NULL until enrichment runs.
  // The ranker (lib/ranker.ts) handles soft filter scoring downstream.
  return db.vectorSearch<Creator>(
    'creators',
    'content_embedding',
    brief.brief_embedding,
    300,
    { sql: 'is_active = true', params: [] },
  );
}

// generateLLMCandidates removed — see discoverCandidates() comment.
