// ============================================================
// Phase 2 — influencer QUALITY scoring.
//
// Distinct from Phase 1 RELEVANCE (how well a creator fits a prompt) and from
// CONFIDENCE (how complete our data is). Quality is an ABSOLUTE 0-100 judgment
// of whether a creator is worth working with, computed from their real
// engagement: followers, engagement rate, and per-post likes/comments.
//
// The product rule: drop anyone scoring below QUALITY_THRESHOLD (80).
//
// Pure + dependency-free so it runs identically in the platform discovery flow,
// the scraper, and the standalone re-score CLI — and is unit-testable with no DB.
// ============================================================

import type { Creator, RecentPost, QualityBand, QualityBreakdown } from '../types/index.js';

export const QUALITY_THRESHOLD = 80;

export type { QualityBand, QualityBreakdown };

export interface QualityScore {
  score: number; // 0-100 weighted composite
  band: QualityBand;
  passed: boolean; // score >= QUALITY_THRESHOLD
  breakdown: QualityBreakdown;
  signals: string[]; // human-readable notes
  effective_engagement_rate: number | null; // the ER we actually used
}

const WEIGHTS = {
  engagement: 0.4,
  comment_quality: 0.2,
  consistency: 0.15,
  authenticity: 0.25,
} as const;

// Expected engagement rate falls as audiences grow — score against a
// tier-appropriate benchmark, not one flat number.
function tierTargetER(followers: number): number {
  if (followers >= 1_000_000) return 0.01;
  if (followers >= 500_000) return 0.013;
  if (followers >= 100_000) return 0.018;
  if (followers >= 50_000) return 0.025;
  if (followers >= 20_000) return 0.035;
  if (followers >= 10_000) return 0.045;
  return 0.06;
}

// Postgres returns NUMERIC / BIGINT columns as strings via node-pg, so coerce
// numeric strings too — not just JS numbers.
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function usablePosts(posts: RecentPost[] | null | undefined): RecentPost[] {
  if (!Array.isArray(posts)) return [];
  return posts.filter((p) => num(p.like_count) !== null || num(p.comment_count) !== null);
}

export function scoreCreatorQuality(creator: Creator): QualityScore {
  const signals: string[] = [];
  const followers = num(creator.follower_count);
  const posts = usablePosts(creator.recent_posts);

  // --- derive engagement rate from the best available source -------------
  let er: number | null = null;
  let perPostEngagements: number[] = [];
  if (followers && followers > 0 && posts.length > 0) {
    perPostEngagements = posts.map((p) => (num(p.like_count) ?? 0) + (num(p.comment_count) ?? 0));
    const meanEng = mean(perPostEngagements);
    er = meanEng / followers;
    signals.push(`ER from ${posts.length} posts`);
  } else if (num(creator.engagement_rate) !== null) {
    er = num(creator.engagement_rate);
    signals.push('ER from stored engagement_rate');
  } else if (followers && followers > 0 && (num(creator.avg_likes) !== null || num(creator.avg_comments) !== null)) {
    er = ((num(creator.avg_likes) ?? 0) + (num(creator.avg_comments) ?? 0)) / followers;
    signals.push('ER from avg likes/comments');
  }

  // Insufficient data: no followers or no engagement signal at all.
  if (!followers || er === null) {
    return {
      score: 0,
      band: 'insufficient_data',
      passed: false,
      breakdown: { engagement: 0, comment_quality: 0, consistency: 0, authenticity: 0 },
      signals: [...signals, 'insufficient engagement data to score'],
      effective_engagement_rate: er,
    };
  }

  // --- 1) engagement vs. tier benchmark (meeting it ≈ 80) ----------------
  const target = tierTargetER(followers);
  const engagement = clamp((er / target) * 80, 0, 100);
  signals.push(`ER ${(er * 100).toFixed(2)}% vs ${(target * 100).toFixed(1)}% target`);

  // --- 2) comment quality: comments per like -----------------------------
  let totalLikes = 0;
  let totalComments = 0;
  if (posts.length > 0) {
    for (const p of posts) {
      totalLikes += num(p.like_count) ?? 0;
      totalComments += num(p.comment_count) ?? 0;
    }
  } else {
    totalLikes = num(creator.avg_likes) ?? 0;
    totalComments = num(creator.avg_comments) ?? 0;
  }
  let comment_quality: number;
  if (totalLikes <= 0) {
    comment_quality = 50; // unknown — neutral
  } else {
    const ratio = totalComments / totalLikes;
    if (ratio > 0.1) {
      comment_quality = 65; // suspiciously high — giveaway/engagement-pod signal
      signals.push('very high comment ratio (giveaway?)');
    } else {
      comment_quality = clamp((ratio / 0.015) * 100, 0, 100); // ~1.5% comments/likes ≈ 100
    }
  }

  // --- 3) consistency across posts (low variance = dependable) -----------
  let consistency: number;
  if (perPostEngagements.length >= 3) {
    const cv = coefficientOfVariation(perPostEngagements);
    consistency = clamp(100 * (1 - cv), 0, 100);
  } else {
    consistency = 60; // not enough posts to judge — neutral
    signals.push('few posts — consistency neutral');
  }

  // --- 4) authenticity: follower/following ratio + credibility -----------
  const following = num(creator.following_count);
  let ffScore = 60;
  if (following && following > 0 && followers) {
    const ff = followers / following;
    ffScore = clamp(ff >= 1 ? 70 + Math.min(30, (ff - 1) * 10) : ff * 70, 0, 100);
    if (ff < 0.5) signals.push('follows more than follows back');
  }
  const credScore = creator.credibility ? creator.credibility.overall_score : null;
  const authenticity = credScore !== null ? 0.5 * ffScore + 0.5 * credScore : ffScore;

  // --- composite ---------------------------------------------------------
  const breakdown: QualityBreakdown = {
    engagement: round2(engagement),
    comment_quality: round2(comment_quality),
    consistency: round2(consistency),
    authenticity: round2(authenticity),
  };
  const score = round2(
    WEIGHTS.engagement * engagement +
      WEIGHTS.comment_quality * comment_quality +
      WEIGHTS.consistency * consistency +
      WEIGHTS.authenticity * authenticity,
  );
  const passed = score >= QUALITY_THRESHOLD;

  return {
    score,
    band: passed ? 'pass' : 'weak',
    passed,
    breakdown,
    signals,
    effective_engagement_rate: er,
  };
}

// --- math helpers --------------------------------------------------------
function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 1;
  const variance = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(variance) / m;
}
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
