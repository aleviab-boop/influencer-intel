// ============================================================
// Ranker — semantic similarity + filter scoring + composite.
// Reads credibility from creator.credibility (JSONB, no extra query).
// ============================================================

import type { Brief, Creator } from '@influencer-intel/shared/types';
import { classifyEntity } from './entity-classifier';

export interface RankedCreator {
  creator: Creator;
  match_score: number;
  similarity: number;
  signals: string[];
}

// Quality gates — drop creators that aren't viable for any campaign.
const MIN_FOLLOWERS_FOR_SHORTLIST = 5_000;
const MAX_FOLLOWING_TO_FOLLOWER_RATIO = 1.5; // fake-account signal

function passesQualityGate(creator: Creator): boolean {
  if (creator.follower_count !== null && creator.follower_count < MIN_FOLLOWERS_FOR_SHORTLIST) return false;
  if (
    creator.follower_count !== null &&
    creator.following_count !== null &&
    creator.follower_count > 0 &&
    creator.following_count / creator.follower_count > MAX_FOLLOWING_TO_FOLLOWER_RATIO
  ) {
    return false;
  }
  if (creator.credibility?.badge === 'red') return false;

  // Drop shops + brand-accounts entirely — brands hire INFLUENCERS, not retailers.
  // (Heuristic: bio language + handle pattern + vision themes + low-following.)
  const cls = classifyEntity(creator);
  if (cls.type === 'shop' || cls.type === 'brand_account') return false;
  return true;
}

export function rankCreators(brief: Brief, creators: Creator[]): RankedCreator[] {
  const filtered = creators.filter(passesQualityGate);
  if (filtered.length === 0) return [];
  const briefVec = brief.brief_embedding;
  const spec = brief.parsed_spec;

  return filtered
    .map((creator) => {
      const sim = briefVec && creator.content_embedding
        ? cosineSimilarity(briefVec, creator.content_embedding)
        : 0;
      const signals: string[] = [];
      let filterScore = 1;

      // Category match — single biggest signal. Vector similarity often
      // pulls adjacent niches; without an explicit category gate a skincare
      // brief returns fashion creators. Adjacent categories (beauty↔skincare)
      // get a soft penalty; unrelated categories (tech↔fashion) get hard.
      if (spec?.category && creator.primary_category) {
        const briefCat = spec.category.toLowerCase();
        const creatorCat = creator.primary_category.toLowerCase();
        if (briefCat === creatorCat) {
          signals.push(`exact category match: ${creatorCat}`);
        } else if (areAdjacentCategories(briefCat, creatorCat)) {
          filterScore *= 0.7;
          signals.push(`adjacent category: ${creatorCat}`);
        } else {
          filterScore *= 0.35;
          signals.push(`off-brief category: ${creatorCat}`);
        }
      }

      if (spec && spec.target_cities && spec.target_cities.length > 0 && creator.primary_city) {
        const matched = spec.target_cities.some(
          (c) => c.toLowerCase() === creator.primary_city!.toLowerCase(),
        );
        if (matched) signals.push(`based in ${creator.primary_city}`);
        else filterScore *= 0.7;
      }

      if (spec && spec.target_languages && spec.target_languages.length > 0 && creator.content_languages) {
        const overlap = spec.target_languages.some((l) =>
          creator.content_languages!.includes(l),
        );
        if (overlap) signals.push(`creates in ${creator.content_languages.join('/')}`);
        else filterScore *= 0.85;
      }

      // Follower-tier signal — log-scale boost so a 1M-follower creator
      // outranks a 5K-follower creator on otherwise-equal signals. This
      // is the right default for premium D2C briefs; cheaper micro briefs
      // can override later.
      let tierScore = 0.3;
      if (creator.follower_count !== null) {
        signals.push(`${formatFollowers(creator.follower_count)} followers`);
        const fc = creator.follower_count;
        if (fc >= 1_000_000) tierScore = 1.0; // mega
        else if (fc >= 500_000) tierScore = 0.92;
        else if (fc >= 100_000) tierScore = 0.85; // macro
        else if (fc >= 50_000) tierScore = 0.75;
        else if (fc >= 20_000) tierScore = 0.62; // micro
        else if (fc >= 10_000) tierScore = 0.5;
        else tierScore = 0.4; // nano
      }

      // Verified IG accounts get a small absolute boost — a real signal
      // brands care about and a hint of authenticity.
      let verifiedBoost = 0;
      if (creator.is_verified) {
        verifiedBoost = 0.08;
        signals.push('verified');
      }

      // Soft penalty for ambiguous shop-vs-creator. The hard cases were
      // dropped at quality-gate; this catches borderline accounts whose
      // bio has SOME shoppy language but isn't clearly a retailer.
      const cls = classifyEntity(creator);
      if (cls.type === 'unknown' && cls.score > 0.25) {
        filterScore *= 0.7;
        signals.push('possible shop / business account');
      }

      const cred = creator.credibility;
      if (cred) {
        if (cred.badge === 'green') {
          signals.push(`credibility ${cred.overall_score}%`);
        } else if (cred.badge === 'red') {
          filterScore *= 0.4;
          signals.push(`low credibility (${cred.overall_score}%)`);
        }
      }

      const credScore = cred ? cred.overall_score / 100 : 0.5;
      const matchScore = Math.round(
        100 * (
          0.40 * sim +
          0.20 * filterScore +
          0.10 * credScore +
          0.20 * tierScore +
          verifiedBoost
        ),
      );

      return {
        creator,
        match_score: clamp(matchScore, 0, 100),
        similarity: sim,
        signals,
      };
    })
    .sort((a, b) => b.match_score - a.match_score);
}

// Coarse adjacency map — when the brief category and creator category
// don't match exactly, soften the penalty for niches that consume similar
// audiences. Anything not listed gets the harder penalty.
const ADJACENT_CATEGORIES: Record<string, Set<string>> = {
  fashion: new Set(['beauty', 'lifestyle']),
  beauty: new Set(['skincare', 'fashion', 'lifestyle', 'wellness']),
  skincare: new Set(['beauty', 'wellness', 'lifestyle']),
  food: new Set(['lifestyle', 'wellness']),
  travel: new Set(['lifestyle', 'food']),
  fitness: new Set(['wellness', 'lifestyle']),
  lifestyle: new Set(['fashion', 'beauty', 'skincare', 'food', 'travel', 'fitness', 'home', 'wellness']),
  home: new Set(['lifestyle']),
  wellness: new Set(['skincare', 'beauty', 'fitness', 'lifestyle']),
  tech: new Set(['lifestyle']),
};

function areAdjacentCategories(a: string, b: string): boolean {
  return Boolean(ADJACENT_CATEGORIES[a]?.has(b) || ADJACENT_CATEGORIES[b]?.has(a));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
