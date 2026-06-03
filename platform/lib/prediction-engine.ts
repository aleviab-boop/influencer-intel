import { getBolticClient } from '@influencer-intel/shared/db';
import type {
  ConnectedAccount, PostInsight, Creator, ContentScores,
  PredictionResult, PerformanceBucket, InsightConfidence, TrendSignal,
} from '@influencer-intel/shared/types';
import { computeCreatorInsights } from './insights-service';

export async function predictContentPerformance(args: {
  creator_id: string;
  content_scores?: ContentScores;
  target_post_time?: string;
}): Promise<PredictionResult> {
  const db = getBolticClient();
  const creator = await db.findById<Creator>('creators', args.creator_id);
  if (!creator) throw new Error('Creator not found');

  const insights = await computeCreatorInsights(args.creator_id);

  // Creator baseline — the foundation of prediction
  const creatorBaselineEr = insights?.rolling_er_30d
    ?? insights?.rolling_er_90d
    ?? creator.engagement_rate
    ?? 0.02;

  // Content multiplier from Gemini scores
  const contentMultiplier = args.content_scores
    ? computeContentMultiplier(args.content_scores)
    : 1.0;

  // Temporal multiplier from target post time
  const targetTime = args.target_post_time ? new Date(args.target_post_time) : new Date();
  const temporalMultiplier = computeTemporalMultiplier(targetTime, insights);

  // Trend multiplier
  const trendMultiplier = await computeTrendMultiplier(args.content_scores, creator.primary_category);

  // Competition multiplier
  const competitionMultiplier = await computeCompetitionMultiplier(
    creator.primary_category, targetTime,
  );

  // Multiplicative prediction
  const predictedErMedian = creatorBaselineEr
    * contentMultiplier * temporalMultiplier
    * trendMultiplier * competitionMultiplier;

  // Confidence interval (wider when data is scarce)
  const dataQuality = insights?.confidence ?? 'very_low';
  const intervalWidth = dataQuality === 'high' ? 0.3
    : dataQuality === 'medium' ? 0.5 : dataQuality === 'low' ? 0.8 : 1.2;
  const lower = Math.max(0, predictedErMedian * (1 - intervalWidth));
  const upper = predictedErMedian * (1 + intervalWidth);

  // Bucket assignment
  const bucket = assignBucket(predictedErMedian, insights);

  // Optimal posting window
  let optimal_post_window: PredictionResult['optimal_post_window'] = null;
  if (insights && insights.best_posting_hours.length > 0) {
    const bestHour = insights.best_posting_hours[0]!;
    const start = new Date(targetTime);
    start.setUTCHours(bestHour, 0, 0, 0);
    const end = new Date(start);
    end.setUTCHours(bestHour + 2);
    optimal_post_window = { start: start.toISOString(), end: end.toISOString() };
  }

  // Trend alignment
  const trendSignals = await db.query<TrendSignal>(
    `SELECT * FROM trend_signals WHERE phase IN ('emerging', 'growing', 'peak') ORDER BY velocity DESC LIMIT 5`,
  );
  const trend_alignment_score = trendMultiplier > 1.1 ? 0.8 : trendMultiplier > 1.0 ? 0.5 : 0.2;

  const improvement_suggestions = args.content_scores?.improvement_suggestions ?? [];

  return {
    bucket,
    bucket_probability: dataQuality === 'high' ? 0.7 : dataQuality === 'medium' ? 0.55 : 0.4,
    predicted_er_range: [lower, upper],
    predicted_er_median: predictedErMedian,
    confidence: dataQuality,
    creator_baseline_er: creatorBaselineEr,
    content_multiplier: contentMultiplier,
    temporal_multiplier: temporalMultiplier,
    trend_multiplier: trendMultiplier,
    competition_multiplier: competitionMultiplier,
    optimal_post_window,
    trend_alignment_score,
    improvement_suggestions,
  };
}

function computeContentMultiplier(scores: ContentScores): number {
  // Map overall_weighted (0-1) to multiplier range [0.5, 2.0]
  const raw = scores.overall_weighted;
  return 0.5 + raw * 1.5;
}

function computeTemporalMultiplier(
  targetTime: Date,
  insights: Awaited<ReturnType<typeof computeCreatorInsights>> | null,
): number {
  if (!insights || insights.best_posting_hours.length === 0) return 1.0;

  const hour = targetTime.getUTCHours();
  const day = targetTime.getUTCDay();

  // Hour alignment — best hour = 1.0 boost, worst = -0.1 penalty
  const hourRank = insights.best_posting_hours.indexOf(hour);
  let hourBoost = 0;
  if (hourRank === 0) hourBoost = 0.10;
  else if (hourRank === 1) hourBoost = 0.05;
  else if (hourRank === 2) hourBoost = 0.02;
  else hourBoost = -0.05;

  // Day alignment
  const dayRank = insights.best_posting_days.indexOf(day);
  let dayBoost = 0;
  if (dayRank === 0) dayBoost = 0.05;
  else if (dayRank === 1) dayBoost = 0.02;
  else dayBoost = -0.02;

  return Math.max(0.85, Math.min(1.15, 1.0 + hourBoost + dayBoost));
}

async function computeTrendMultiplier(
  contentScores: ContentScores | undefined,
  category: string | null,
): Promise<number> {
  if (!contentScores) return 1.0;

  const trendLeverage = contentScores.trend_leverage;
  if (trendLeverage < 0.3) return 0.9;
  if (trendLeverage < 0.5) return 1.0;

  // Check active trends in this category
  const db = getBolticClient();
  const trends = await db.query<TrendSignal>(
    `SELECT * FROM trend_signals WHERE phase IN ('emerging', 'growing') AND $1 = ANY(categories) LIMIT 5`,
    [category ?? 'general'],
  ).catch(() => [] as TrendSignal[]);

  if (trends.length === 0) return 1.0 + (trendLeverage - 0.5) * 0.5;

  // Emerging trends get bigger boost than growing
  const bestPhase = trends.some((t) => t.phase === 'emerging') ? 'emerging' : 'growing';
  if (bestPhase === 'emerging') return Math.min(1.5, 1.2 + trendLeverage * 0.3);
  return Math.min(1.3, 1.1 + trendLeverage * 0.2);
}

async function computeCompetitionMultiplier(
  category: string | null,
  targetTime: Date,
): Promise<number> {
  // Estimate competition based on time of day + category
  // Peak hours (9-11am, 7-9pm IST = 3:30-5:30 UTC, 13:30-15:30 UTC) = more competition
  const hour = targetTime.getUTCHours();
  const isPeakHour = (hour >= 3 && hour <= 6) || (hour >= 13 && hour <= 16);
  const isWeekday = targetTime.getUTCDay() >= 1 && targetTime.getUTCDay() <= 5;

  let multiplier = 1.0;
  if (isPeakHour) multiplier -= 0.05;
  if (isWeekday) multiplier -= 0.02;

  return Math.max(0.9, Math.min(1.1, multiplier));
}

function assignBucket(
  predictedEr: number,
  insights: Awaited<ReturnType<typeof computeCreatorInsights>> | null,
): PerformanceBucket {
  if (!insights || insights.rolling_er_90d == null) {
    // No history — use absolute thresholds
    if (predictedEr >= 0.08) return 'breakout';
    if (predictedEr >= 0.04) return 'above_average';
    if (predictedEr >= 0.02) return 'average';
    return 'below_average';
  }

  // Relative to creator's own history
  const baseline = insights.rolling_er_90d;
  const ratio = predictedEr / baseline;
  if (ratio >= 2.0) return 'breakout';
  if (ratio >= 1.3) return 'above_average';
  if (ratio >= 0.7) return 'average';
  return 'below_average';
}
