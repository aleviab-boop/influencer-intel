// ============================================================
// Creator analytics assembler — the single source of truth for the big
// dashboard payload served by /api/creator/analytics.
//
// The analytics endpoint has TWO data paths that produce the SAME payload:
//   • live — a fresh Instagram Graph pull (posts enriched with per-media
//     insights: reach/plays/saves/shares).
//   • db   — the STORED `creators` row (recent_posts + audience_demographics +
//     credibility + follower/engagement stats), for creators who haven't
//     connected an IG account or whose token has gone stale.
//
// Both paths normalise their data into `AnalyticsPost[]` + a handful of scalars,
// then call `assembleCreatorAnalytics` — a PURE function that runs the ~30
// analysis-lib calls and returns the payload body. Every downstream section on
// the preview page is independently guarded, so a sparse DB payload simply
// renders fewer sections rather than breaking.
//
// Pure and deterministic (no network, no writes). Postgres NUMERIC/BIGINT come
// back as strings, so callers must coerce before handing numbers in here.
// ============================================================

import type { getBolticClient } from '@influencer-intel/shared/db';
import { forecastReels, contentBreakdown } from '@/lib/reel-forecast';
import { audienceQuality } from '@/lib/audience-quality';
import { analyzeContent } from '@/lib/content-analysis';
import { analyzeCaptions } from '@/lib/caption-analysis';
import { computeBenchmark, tierLabel, tierWindow } from '@/lib/peer-benchmark';
import type { PeerBenchmark } from '@/lib/peer-benchmark';
import { estimateMediaValue } from '@/lib/media-value';
import { suggestRateCard } from '@/lib/media-kit';
import { analyzeProfile } from '@/lib/profile-optimizer';
import { planTierClimb } from '@/lib/tier-climb';
import { buildRateMenu } from '@/lib/rate-menu';
import { generatePitchCoach } from '@/lib/pitch-coach';
import { analyzePostingTime } from '@/lib/posting-time';
import { analyzeFormatTiming } from '@/lib/format-timing';
import { generateContentPlaybook } from '@/lib/content-playbook';
import { generateContentIdeas } from '@/lib/content-ideas';
import { analyzeAudience, type DemographicsInput } from '@/lib/audience-insights';
import { projectGrowth } from '@/lib/growth-projection';
import { analyzeWinningFormula } from '@/lib/winning-formula';
import { analyzePostingConsistency } from '@/lib/posting-consistency';
import { analyzeCaptionHooks } from '@/lib/caption-hooks';
import { analyzeCaptionLength } from '@/lib/caption-length';
import { analyzeEngagementReliability } from '@/lib/engagement-reliability';
import { analyzeFormatRoi } from '@/lib/format-roi';
import { analyzeDistributionSignals } from '@/lib/distribution-signals';
import { analyzeContentPillars } from '@/lib/content-pillars';
import { analyzeBrandSafety } from '@/lib/brand-safety';
import { buildScorecard } from '@/lib/creator-scorecard';
import { analyzePostSpotlight } from '@/lib/post-spotlight';
import { analyzeHashtagStrategy } from '@/lib/hashtag-strategy';
import { analyzePostingSchedule } from '@/lib/posting-schedule';
import { analyzeEngagementTrend } from '@/lib/engagement-trend';
import { generatePitchDraft } from '@/lib/pitch-draft';
import { generateRecommendations } from '@/lib/recommendations';

// How many recent posts feed the "derived stats" block. Live requests enrich
// only this many with per-media insights, so aggregates use the same window on
// both paths for consistency.
export const INSIGHTS_CAP = 18;

/** Normalised post shape shared by the live + db analytics paths. */
export interface AnalyticsPost {
  id: string;
  shortcode: string;
  permalink: string;
  media_type: string;
  thumbnail_url: string | null;
  media_url: string | null;
  caption: string | null;
  timestamp: string;
  like_count: number;
  comments_count: number;
  er: number | null;
  reach: number | null;
  plays: number | null;
  saved: number | null;
  shares: number | null;
}

/** The bio fields feeding the profile-optimizer + pitch-draft. */
export interface AssembleProfile {
  name: string | null;
  username: string | null;
  biography: string | null;
  website: string | null;
}

/** Same-tier / same-niche engagement cohorts for peer benchmarking. */
export interface PeerCohorts {
  niche_label: string | null;
  tier_ers: number[];
  niche_ers: number[];
}

export interface AssembleInput {
  followers: number;
  /** Total posts on the account (profile.media_count); falls back to posts.length. */
  media_count: number | null;
  /** Creator niche (category first, vision niche fallback); drives ideas/pitch copy. */
  niche: string | null;
  /** ALL normalised posts (most-recent first). */
  posts: AnalyticsPost[];
  /** Follower-snapshot history for growth projection ([] if none). */
  growth: { date: string; followers: number }[];
  /** Audience split (IG demographics blob, or a reshaped DB one). */
  demographics: DemographicsInput | null;
  profile: AssembleProfile;
  cohorts: PeerCohorts;
  /**
   * Stored aggregate fallbacks for DB creators whose recent_posts are sparse
   * but who still have a stored engagement_rate / avg_likes / avg_views. Used
   * only when the post-derived value is null.
   */
  fallback?: { avg_er?: number | null; avg_likes?: number | null; avg_reel_plays?: number | null };
}

/**
 * Load the peer-benchmark cohorts for a creator: same-follower-tier engagement
 * rates (excluding self) and, when the creator has a niche, the same-tier +
 * same-niche subset. Also resolves the creator's own niche label (category,
 * else the vision niche) so the caller can reuse it for ideas/pitch copy.
 *
 * Best-effort by design — callers wrap this so a cohort miss never sinks the
 * whole analytics response.
 */
export async function loadPeerCohorts(
  db: ReturnType<typeof getBolticClient>,
  creatorId: string,
  followers: number,
): Promise<PeerCohorts> {
  const empty: PeerCohorts = { niche_label: null, tier_ers: [], niche_ers: [] };
  if (!Number.isFinite(followers) || followers <= 0) return empty;

  const { lo, hi } = tierWindow(followers);

  // The creator's own niche (category first, vision niche fallback).
  const nicheRows = await db.query<{ primary_category: string | null; vision_niche: string | null }>(
    `SELECT primary_category, raw_metadata->'vision'->>'niche' AS vision_niche
       FROM creators WHERE id = $1 LIMIT 1`,
    [creatorId],
  );
  const nicheRaw = (nicheRows[0]?.primary_category ?? nicheRows[0]?.vision_niche ?? '').trim().toLowerCase();
  const nicheLabel = nicheRaw || null;

  // Same-tier cohort (excluding self), ER as a fraction.
  const tierRows = await db.query<{ engagement_rate: number | string }>(
    `SELECT engagement_rate FROM creators
      WHERE engagement_rate IS NOT NULL AND engagement_rate > 0
        AND follower_count BETWEEN $1 AND $2
        AND id <> $3`,
    [lo, hi, creatorId],
  );
  const tierErs = tierRows.map((r) => Number(r.engagement_rate)).filter((v) => Number.isFinite(v) && v > 0);

  // Same-tier + same-niche cohort.
  let nicheErs: number[] = [];
  if (nicheLabel) {
    const nicheRowsC = await db.query<{ engagement_rate: number | string }>(
      `SELECT engagement_rate FROM creators
        WHERE engagement_rate IS NOT NULL AND engagement_rate > 0
          AND follower_count BETWEEN $1 AND $2
          AND id <> $3
          AND (LOWER(primary_category) = $4 OR LOWER(raw_metadata->'vision'->>'niche') = $4)`,
      [lo, hi, creatorId, nicheLabel],
    );
    nicheErs = nicheRowsC.map((r) => Number(r.engagement_rate)).filter((v) => Number.isFinite(v) && v > 0);
  }

  return { niche_label: nicheLabel, tier_ers: tierErs, niche_ers: nicheErs };
}

/**
 * Run every analysis lib over a creator's normalised posts + scalars and return
 * the analytics payload body (everything except `connected`/`account`/`profile`,
 * which the caller supplies). Pure — safe to call from either data path.
 */
export function assembleCreatorAnalytics(input: AssembleInput) {
  const { followers, posts, growth, demographics, profile, cohorts, fallback, niche } = input;

  // ---- Derived aggregate stats -------------------------------------------
  const enriched = posts.slice(0, INSIGHTS_CAP);
  const avg = (nums: number[]): number | null =>
    nums.length ? Math.round(nums.reduce((s, v) => s + v, 0) / nums.length) : null;

  const reels = enriched.filter((p) => p.media_type === 'VIDEO' || p.media_type === 'REELS');
  const images = enriched.filter((p) => p.media_type !== 'VIDEO' && p.media_type !== 'REELS');
  const ers = enriched.map((p) => p.er).filter((v): v is number => v != null);

  const stats = {
    posts_analyzed: enriched.length,
    total_media: input.media_count ?? posts.length,
    avg_likes: avg(enriched.map((p) => p.like_count)) ?? fallback?.avg_likes ?? null,
    avg_comments: avg(enriched.map((p) => p.comments_count)),
    avg_er: (ers.length ? ers.reduce((s, v) => s + v, 0) / ers.length : null) ?? fallback?.avg_er ?? null,
    reels_count: reels.length,
    images_count: images.length,
    avg_reel_plays: avg(reels.map((p) => p.plays ?? 0).filter((v) => v > 0)) ?? fallback?.avg_reel_plays ?? null,
    avg_reach: avg(enriched.map((p) => p.reach ?? 0).filter((v) => v > 0)),
  };

  // ---- Posting cadence ----------------------------------------------------
  const ts = posts
    .map((p) => new Date(p.timestamp).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  let posts_per_week: number | null = null;
  let avg_days_between_posts: number | null = null;
  if (ts.length >= 2) {
    const spanMs = ts[0]! - ts[ts.length - 1]!;
    const weeks = spanMs / (7 * 86400000);
    if (weeks > 0) posts_per_week = Math.round((ts.length / weeks) * 10) / 10;
    const gaps: number[] = [];
    for (let i = 0; i < ts.length - 1; i++) gaps.push((ts[i]! - ts[i + 1]!) / 86400000);
    avg_days_between_posts = Math.round((gaps.reduce((s, v) => s + v, 0) / gaps.length) * 10) / 10;
  }

  // ---- Peer benchmarking --------------------------------------------------
  // Rank this creator's engagement against the similar-tier (and same-niche)
  // cohorts loaded by the caller. Only meaningful once we have an ER.
  let benchmark: PeerBenchmark | null = null;
  if (followers > 0 && stats.avg_er != null && stats.avg_er > 0) {
    benchmark = computeBenchmark({
      your_er: stats.avg_er,
      tier_label: tierLabel(followers),
      niche_label: cohorts.niche_label,
      tier_ers: cohorts.tier_ers,
      niche_ers: cohorts.niche_ers,
    });
  }

  // Predictive + depth analyses, all from the posts we already have.
  const reelForecast = forecastReels(enriched);
  const contentBreak = contentBreakdown(enriched);
  const audQuality = audienceQuality(followers, enriched);
  const contentAnalysis = analyzeContent(enriched);
  const captionAnalysis = analyzeCaptions(enriched);
  // Best-time analysis uses ALL posts (more timestamps = better).
  const postingTime = analyzePostingTime(posts.map((p) => ({ timestamp: p.timestamp, er: p.er })));
  // Format × timing grid — which format wins in which posting window.
  const formatTiming = analyzeFormatTiming(
    posts.map((p) => ({ media_type: p.media_type, timestamp: p.timestamp, er: p.er })),
  );
  // Overall engagement momentum across every format (not just reels).
  const engagementTrend = analyzeEngagementTrend(posts.map((p) => ({ timestamp: p.timestamp, er: p.er })));
  // Prescriptive "next 3 posts" plan, synthesised from the above signals.
  const contentPlaybook = generateContentPlaybook({
    content_breakdown: contentBreak,
    reel_forecast: reelForecast,
    content_analysis: contentAnalysis,
    caption_analysis: captionAnalysis,
    posting_time: postingTime,
  });
  // Ready-to-shoot idea variations off the winning format + topic.
  const contentIdeas = generateContentIdeas({
    best_type: contentBreak.best_type,
    niche,
    top_hashtag: contentAnalysis.hashtags?.[0]?.tag ?? null,
    caption_best_length: captionAnalysis.available ? captionAnalysis.best_length : null,
  });
  // Whole-audience profile narrative from the demographics blob.
  const audienceInsights = analyzeAudience(demographics);
  // Forward follower-growth projection from the snapshot history.
  const growthProjection = projectGrowth(growth, followers);
  // Reframe that pace around named creator tiers + the rate uplift a climb unlocks.
  const tierClimb = planTierClimb({ followers, daily_rate: growthProjection.daily_rate, avg_er: stats.avg_er });
  // Diagnostic: what do the creator's TOP posts have in common vs the rest?
  const winningFormula = analyzeWinningFormula(
    posts.map((p) => ({ media_type: p.media_type, caption: p.caption, timestamp: p.timestamp, er: p.er })),
  );
  // How RELIABLY (not just how much) the creator posts — cadence rhythm/health.
  const postingConsistency = analyzePostingConsistency(
    posts.map((p) => ({ timestamp: p.timestamp, er: p.er })),
  );
  // Reusable caption hooks mined from the openers of the creator's best posts.
  const captionHooks = analyzeCaptionHooks(
    posts.map((p) => ({ caption: p.caption, er: p.er, permalink: p.permalink })),
  );
  // Does caption LENGTH itself track with engagement? Find the sweet-spot band.
  const captionLength = analyzeCaptionLength(
    posts.map((p) => ({ caption: p.caption, er: p.er })),
  );
  // How PREDICTABLE is engagement post-to-post, and what floor can they promise?
  const engagementReliability = analyzeEngagementReliability(
    posts.map((p) => ({ er: p.er })),
  );
  // Which FORMAT pays off best per slot, and does the current mix match it?
  const formatRoi = analyzeFormatRoi(
    posts.map((p) => ({ media_type: p.media_type, er: p.er, reach: p.reach })),
  );
  // Saves/shares — the high-intent actions IG weighs most for distribution.
  const distributionSignals = analyzeDistributionSignals(
    enriched.map((p) => ({ saved: p.saved, shares: p.shares, reach: p.reach, likes: p.like_count, comments: p.comments_count })),
  );
  // Recurring content themes (pillars) and which ones over/under-perform their share.
  const contentPillars = analyzeContentPillars(
    posts.map((p) => ({ caption: p.caption, er: p.er })),
  );
  // Sponsorship-readiness: disclosure hygiene, promo balance, language safety.
  const brandSafety = analyzeBrandSafety(posts.map((p) => ({ caption: p.caption })));
  // Real best/under-performing posts with plain-English "why" reasoning.
  const postSpotlight = analyzePostSpotlight(posts.map((p) => ({
    id: p.id, permalink: p.permalink, thumbnail_url: p.thumbnail_url, media_url: p.media_url,
    media_type: p.media_type, caption: p.caption, timestamp: p.timestamp,
    er: p.er, like_count: p.like_count, comments_count: p.comments_count,
  })));
  // Hashtag keep/drop/test tiers + optimal tag-count read.
  const hashtagStrategy = analyzeHashtagStrategy(posts.map((p) => ({ caption: p.caption, er: p.er })));
  // Day × time-of-day grid → 3 concrete recommended posting slots (IST).
  const postingSchedule = analyzePostingSchedule(posts.map((p) => ({ timestamp: p.timestamp, er: p.er })));
  // One-line rollup: blend the sub-scores into a media-kit-ready grade.
  const scorecard = buildScorecard({
    benchmark,
    audience_quality: audQuality,
    posting_consistency: postingConsistency,
    brand_safety: brandSafety,
    growth_projection: growthProjection,
  });

  // Earned media value — from the same enriched posts + cadence.
  const avgOf = (nums: number[]): number | null =>
    nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
  const savesVals = enriched.map((p) => p.saved ?? 0).filter((v) => v > 0);
  const sharesVals = enriched.map((p) => p.shares ?? 0).filter((v) => v > 0);
  const mediaValue = estimateMediaValue({
    followers,
    avg_reach: stats.avg_reach,
    avg_likes: stats.avg_likes,
    avg_comments: stats.avg_comments,
    avg_saves: avgOf(savesVals),
    avg_shares: avgOf(sharesVals),
    posts_per_week,
  });

  // Pitch coach — synthesises the money + performance signals into a
  // negotiation cheat-sheet. Rate card is computed here to anchor the ask.
  const rateCard = suggestRateCard(followers, stats.avg_er);
  // Expand the rate card into a copy-ready deliverable menu (packages + add-ons).
  const rateMenu = buildRateMenu(rateCard);
  // Grade the bio/profile against what converts profile-visitors into follows.
  const profileOptimizer = analyzeProfile({
    name: profile.name,
    username: profile.username,
    biography: profile.biography,
    website: profile.website,
    niche,
    followers,
  });
  const pitchCoach = generatePitchCoach({
    followers,
    tier_label: tierLabel(followers),
    avg_er: stats.avg_er,
    media_value: mediaValue,
    benchmark,
    audience_quality: audQuality,
    content_breakdown: contentBreak,
    rate_card: rateCard,
    posts_per_week,
  });

  // Copy-ready pitch message — turns the numbers above into an outreach
  // email/DM the creator can paste, tweak a couple of {placeholders}, and send.
  const pitchDraft = generatePitchDraft({
    name: profile.name,
    handle: profile.username,
    tier_label: tierLabel(followers),
    niche,
    followers,
    avg_er: stats.avg_er,
    media_value: mediaValue,
    benchmark,
    content_breakdown: contentBreak,
    posts_per_week,
  });

  // Saves + shares share of interactions — feeds a recommendation.
  const interTotals = enriched.reduce(
    (a, p) => {
      a.total += (p.like_count || 0) + (p.comments_count || 0) + (p.saved ?? 0) + (p.shares ?? 0);
      a.sv += (p.saved ?? 0) + (p.shares ?? 0);
      return a;
    },
    { total: 0, sv: 0 },
  );
  const savesSharesPct = interTotals.total > 0 ? Math.round((interTotals.sv / interTotals.total) * 100) : null;

  const recommendations = generateRecommendations({
    content_breakdown: contentBreak,
    reel_forecast: reelForecast,
    content_analysis: contentAnalysis,
    audience_quality: audQuality,
    caption_analysis: captionAnalysis,
    benchmark,
    posting_time: postingTime,
    posts_per_week,
    saves_shares_pct: savesSharesPct,
  });

  return {
    stats,
    cadence: { posts_per_week, avg_days_between_posts },
    growth,
    recommendations,
    reel_forecast: reelForecast,
    content_breakdown: contentBreak,
    audience_quality: audQuality,
    content_analysis: contentAnalysis,
    caption_analysis: captionAnalysis,
    benchmark,
    media_value: mediaValue,
    pitch_coach: pitchCoach,
    rate_menu: rateMenu,
    profile_optimizer: profileOptimizer,
    pitch_draft: pitchDraft,
    posting_time: postingTime,
    format_timing: formatTiming,
    content_playbook: contentPlaybook,
    content_ideas: contentIdeas,
    audience_insights: audienceInsights,
    growth_projection: growthProjection,
    tier_climb: tierClimb,
    winning_formula: winningFormula,
    posting_consistency: postingConsistency,
    caption_hooks: captionHooks,
    caption_length: captionLength,
    engagement_reliability: engagementReliability,
    format_roi: formatRoi,
    distribution_signals: distributionSignals,
    content_pillars: contentPillars,
    brand_safety: brandSafety,
    scorecard,
    post_spotlight: postSpotlight,
    hashtag_strategy: hashtagStrategy,
    posting_schedule: postingSchedule,
    engagement_trend: engagementTrend,
    posts,
    demographics,
  };
}
