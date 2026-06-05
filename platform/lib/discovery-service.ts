// ============================================================
// Discovery service — Phase 1.
//
// prompt → parse → embed → search the ICMP creators directory (same Boltic
// DB) → rank for relevance → score data confidence → dedupe → persist.
//
// Two writes per result:
//   1. creators        — fills the per-influencer discovery facts (only when
//                        empty; never clobbers scraped data).
//   2. discovery_results — the per-prompt relevance ranking (idempotent on
//                        (prompt, creator_id), so re-running updates in place).
//
// Relevance reuses the existing ranker (lib/ranker.ts). Confidence is a
// separate data-quality axis, deliberately NOT the same as relevance.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type {
  Brief,
  Creator,
  DiscoverySource,
  ParsedBriefSpec,
  QualityBand,
} from '@influencer-intel/shared/types';
import { scoreCreatorQuality, QUALITY_THRESHOLD } from '@influencer-intel/shared/scoring';
import { rankCreators } from './ranker';

export const DISCOVERY_TARGET_SIZE = 30;

// How many candidates to pull from the vector index before ranking.
const CANDIDATE_POOL = 300;

// How many top-ranked candidates we quality-score per run (bounds DB writes).
const SCORE_WORKING_SET = 60;

// Cap on below-gate matches returned for display (so a starved prompt still
// shows who it matched instead of a blank screen).
const BELOW_THRESHOLD_LIMIT = 24;

export interface DiscoveredInfluencer {
  creator_id: string;
  name: string | null;
  genre: string | null;
  region: string | null;
  niche: string | null;
  platform: string;
  source: DiscoverySource;
  source_url: string;
  relevance_score: number;
  confidence_score: number;
  quality_score: number;
  quality_band: QualityBand;
  tags: string[];
  rank: number;
}

export interface DiscoveryRun {
  prompt: string;
  parsed_spec: ParsedBriefSpec;
  results: DiscoveredInfluencer[];
  below_threshold: DiscoveredInfluencer[];
  min_quality: number;
  dropped: { below_threshold: number; insufficient_data: number };
}

export async function runDiscovery(
  prompt: string,
  options?: { minQuality?: number },
): Promise<DiscoveryRun> {
  const minQuality = options?.minQuality ?? QUALITY_THRESHOLD;
  const db = getBolticClient();
  const llm = getOpenAIClient();

  // 1. Parse the natural-language prompt into a structured spec.
  const parsed = (await llm.parseBrief(prompt)) as ParsedBriefSpec;

  // 2. Embed the prompt + the structured cues for a richer match vector.
  const embedText = [
    prompt,
    parsed.category ?? '',
    parsed.genre ?? '',
    parsed.niche ?? '',
    parsed.region ?? '',
    (parsed.keywords ?? []).join(' '),
    (parsed.target_cities ?? []).join(' '),
  ]
    .join(' ')
    .trim();
  const embedding = await llm.embed(embedText);

  // 3. Ephemeral brief so we can reuse the existing ranker without a DB row.
  const brief: Brief = {
    id: 'discovery',
    brand_id: 'discovery',
    raw_text: prompt,
    parsed_spec: parsed,
    brief_embedding: embedding,
    status: 'parsed',
    created_at: new Date().toISOString(),
    parsed_at: new Date().toISOString(),
  };

  // 4. Search the ICMP creators directory (same Boltic DB) by vector similarity.
  const candidates = await db.vectorSearch<Creator>(
    'creators',
    'content_embedding',
    embedding,
    CANDIDATE_POOL,
    { sql: 'is_active = true', params: [] },
  );

  // 5. Dedupe by creator id (vectorSearch returns unique rows, but a handle
  //    can surface twice across cross-platform duplicates — keep the first).
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // 6. Rank for relevance (reuses category/city/language/credibility scoring).
  const ranked = rankCreators(brief, unique).slice(0, SCORE_WORKING_SET);

  // 7. Phase 2 quality gate — score each candidate's followers/engagement/
  //    likes/comments, persist the score, and split into pass vs below-gate.
  const keywords = (parsed.keywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
  const dropped = { below_threshold: 0, insufficient_data: 0 };
  const kept: Array<{ creator: Creator; relevance: number; quality: number; band: QualityBand }> = [];
  const belowRaw: Array<{ creator: Creator; relevance: number; quality: number; band: QualityBand }> = [];

  for (const r of ranked) {
    const c = r.creator;
    const quality = scoreCreatorQuality(c);

    // Persist quality on the creator (a fact about them, recorded even if dropped).
    await db.query(
      `UPDATE creators SET
         quality_score     = $2,
         quality_breakdown = $3::jsonb,
         quality_band      = $4,
         quality_scored_at = NOW()
       WHERE id = $1`,
      [c.id, quality.score, JSON.stringify(quality.breakdown), quality.band],
    );

    if (quality.score >= minQuality) {
      if (kept.length < DISCOVERY_TARGET_SIZE) {
        kept.push({ creator: c, relevance: r.match_score, quality: quality.score, band: quality.band });
      }
    } else {
      if (quality.band === 'insufficient_data') dropped.insufficient_data++;
      else dropped.below_threshold++;
      // Keep the top matches around so the UI never shows a blank screen —
      // they're shown separately as "below threshold", not stored.
      if (belowRaw.length < BELOW_THRESHOLD_LIMIT) {
        belowRaw.push({ creator: c, relevance: r.match_score, quality: quality.score, band: quality.band });
      }
    }
  }

  const shape = (
    c: Creator,
    relevance: number,
    quality: number,
    band: QualityBand,
    rank: number,
  ): DiscoveredInfluencer => ({
    creator_id: c.id,
    name: c.display_name,
    genre: c.genre ?? c.primary_category ?? parsed.genre ?? null,
    region: c.region ?? c.primary_city ?? parsed.region ?? null,
    niche: c.niche ?? parsed.niche ?? null,
    platform: c.platform,
    source: c.source ?? 'icmp',
    source_url: c.profile_url,
    relevance_score: relevance,
    confidence_score: computeConfidence(c),
    quality_score: quality,
    quality_band: band,
    tags: matchedTags(c, keywords),
    rank,
  });

  // 8. Persist + shape the kept (above-threshold) influencers.
  const results: DiscoveredInfluencer[] = [];
  for (let i = 0; i < kept.length; i++) {
    const { creator: c, relevance, quality, band } = kept[i]!;
    const inf = shape(c, relevance, quality, band, i + 1);

    // 8a. Enrich the creator row — COALESCE only fills NULLs so we never
    //     clobber richer scraped/OAuth data. tags is text[], so raw SQL.
    await db.query(
      `UPDATE creators SET
         genre            = COALESCE(genre, $2),
         niche            = COALESCE(niche, $3),
         region           = COALESCE(region, $4),
         source           = COALESCE(source, $5),
         source_url       = COALESCE(source_url, $6),
         confidence_score = $7,
         tags             = CASE WHEN tags IS NULL OR cardinality(tags) = 0
                                 THEN $8::text[] ELSE tags END
       WHERE id = $1`,
      [c.id, inf.genre, inf.niche, inf.region, inf.source, c.profile_url, inf.confidence_score, inf.tags],
    );

    // 8b. Persist the per-prompt result. Idempotent on (prompt, creator_id).
    await db.query(
      `INSERT INTO discovery_results
         (prompt, prompt_embedding, creator_id, rank, relevance_score,
          confidence_score, quality_score, matched_tags, source)
       VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8::text[], $9)
       ON CONFLICT (prompt, creator_id) DO UPDATE SET
         rank             = EXCLUDED.rank,
         relevance_score  = EXCLUDED.relevance_score,
         confidence_score = EXCLUDED.confidence_score,
         quality_score    = EXCLUDED.quality_score,
         matched_tags     = EXCLUDED.matched_tags,
         prompt_embedding = EXCLUDED.prompt_embedding`,
      [prompt, vectorLiteral(embedding), c.id, inf.rank, inf.relevance_score, inf.confidence_score, inf.quality_score, inf.tags, inf.source],
    );

    results.push(inf);
  }

  // 9. Shape (but don't store) the below-gate matches for display.
  const below_threshold = belowRaw.map((b, i) => shape(b.creator, b.relevance, b.quality, b.band, i + 1));

  return { prompt, parsed_spec: parsed, results, below_threshold, min_quality: minQuality, dropped };
}

// Data-quality confidence (0-100), distinct from relevance. Blends field
// completeness, source trust, recency, and any existing credibility score.
function computeConfidence(c: Creator): number {
  const fields: unknown[] = [
    c.bio,
    c.follower_count,
    c.engagement_rate,
    c.primary_category,
    c.primary_city,
    c.profile_photo_url,
    c.recent_posts,
  ];
  const present = fields.filter(
    (f) => f !== null && f !== undefined && !(Array.isArray(f) && f.length === 0),
  ).length;
  const completeness = present / fields.length;

  const trustBySource: Record<DiscoverySource, number> = {
    icmp: 0.9,
    trends: 0.8,
    scrape: 0.7,
    manual: 0.6,
  };
  const trust = trustBySource[c.source ?? 'scrape'] ?? 0.7;

  let recency = 0.5;
  if (c.last_scraped_at) {
    const ageDays = (Date.now() - new Date(c.last_scraped_at).getTime()) / 86_400_000;
    recency = ageDays <= 14 ? 1 : ageDays <= 90 ? 0.7 : 0.4;
  }

  const credConf = c.credibility ? c.credibility.overall_score / 100 : 0.5;

  const score = 100 * (0.35 * completeness + 0.25 * trust + 0.2 * recency + 0.2 * credConf);
  return round2(clamp(score, 0, 100));
}

// Tags carried on the result: prompt keywords that appear in the creator's
// text, unioned with any tags the creator already carries.
function matchedTags(c: Creator, keywords: string[]): string[] {
  const haystack = [
    c.bio ?? '',
    c.primary_category ?? '',
    c.niche ?? '',
    c.genre ?? '',
    (c.tags ?? []).join(' '),
    (c.content_languages ?? []).join(' '),
  ]
    .join(' ')
    .toLowerCase();
  const fromPrompt = keywords.filter((k) => haystack.includes(k));
  const existing = (c.tags ?? []).map((t) => t.toLowerCase());
  return Array.from(new Set([...fromPrompt, ...existing]));
}

function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
