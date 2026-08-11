// ============================================================
// Reach & Likes predictor.
//
// Predicts the raw VIEWS and LIKES a creator's next post/reel is likely to get,
// from three signals the user cares about:
//   1. the creator's day-to-day baseline — the real distribution of their own
//      recent posts (median + spread), format-aware (reels vs photos);
//   2. whether the content is trending right now — the caption is matched
//      against the live trend_signals table (emerging/growing/peak) and each
//      matched trend contributes a bounded lift weighted by phase + velocity;
//   3. timing — whether the planned post time lands in the creator's own
//      best-performing day-parts.
//
// It is fully self-contained (no Gemini): everything is derived from the
// caption text, the requested format/time, and data already in the DB. Works
// for ANY creator via computeScrapedInsights (scraped or OAuth-backed).
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type {
  InsightConfidence, PerformanceBucket, TrendSignal, ReachPrediction, MatchedTrend,
} from '@influencer-intel/shared/types';
import { computeScrapedInsights } from './insights-service';
import { loadReachModels, likesMultiplier, viewsMultiplier, type ContentFeatures } from './ml/reach-model';
import { scoreContent } from '@influencer-intel/shared/content-scorer';
import type { ContentScores } from '@influencer-intel/shared/types';

export interface ReachPredictorArgs {
  creator_id: string;
  format: 'reel' | 'photo' | 'carousel';
  caption?: string;
  hashtags?: string[];        // optional explicit tags, merged with caption tags
  post_time?: string;         // ISO; defaults to now
  media_url?: string;         // draft media to vision-score (photo or reel cover)
  thumbnail_url?: string;     // explicit image frame to show the vision model
}

type Post = {
  post_type: string | null;
  posted_at: string | null;
  like_count: number | null;
  comment_count: number | null;
  view_count: number | null;
};

// ── small stats helpers ─────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = clamp(Math.round((p / 100) * (s.length - 1)), 0, s.length - 1);
  return s[idx]!;
}

const VIDEO_TYPES = new Set(['reels', 'reel', 'video', 'clips']);
const isVideo = (t: string | null): boolean => !!t && VIDEO_TYPES.has(t.toLowerCase());
const formatMatches = (t: string | null, fmt: ReachPredictorArgs['format']): boolean => {
  const s = (t ?? '').toLowerCase();
  if (fmt === 'reel') return VIDEO_TYPES.has(s);
  if (fmt === 'carousel') return s.includes('carousel') || s.includes('album') || s.includes('sidecar');
  return s === 'image' || s === 'photo' || s === '';
};

// Tokenise a caption into candidate trend tokens: hashtags (without #) plus
// meaningful words, lowercased.
function tokenize(caption: string, extra: string[]): Set<string> {
  const tokens = new Set<string>();
  const push = (w: string) => { const t = w.toLowerCase().replace(/^#/, '').trim(); if (t.length >= 3) tokens.add(t); };
  for (const m of caption.matchAll(/#(\w+)/g)) push(m[1]!);
  for (const w of caption.split(/[^A-Za-z0-9#']+/)) push(w);
  for (const h of extra) push(h);
  return tokens;
}

// ── trend matching ──────────────────────────────────────────────────────────
// Phase weight: emerging content still climbing gives the biggest tailwind.
const PHASE_WEIGHT: Record<TrendSignal['phase'], number> = {
  emerging: 1.0, growing: 0.7, peak: 0.4, saturated: 0.12, declining: 0,
};

async function matchTrends(
  tokens: Set<string>,
  category: string | null,
): Promise<{ multiplier: number; score: number; matched: MatchedTrend[] }> {
  const db = getBolticClient();
  const signals = await db.query<TrendSignal>(
    `SELECT * FROM trend_signals
     WHERE phase IN ('emerging','growing','peak')
     ORDER BY velocity DESC LIMIT 200`,
  ).catch(() => [] as TrendSignal[]);

  const cat = (category ?? '').toLowerCase();
  const matched: MatchedTrend[] = [];
  let sumBoost = 0;

  for (const s of signals) {
    const idTok = String(s.identifier ?? '').toLowerCase().replace(/^#/, '').trim();
    const nameToks = String(s.display_name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const inCategory = Array.isArray(s.categories) && cat ? s.categories.some((c) => String(c).toLowerCase() === cat) : false;

    let hitOn: string | null = null;
    if (idTok && tokens.has(idTok)) hitOn = idTok;
    else { const nm = nameToks.find((w) => tokens.has(w)); if (nm) hitOn = nm; }
    // A category-only match counts at reduced weight (the trend fits the
    // creator's niche even if the caption didn't name it).
    const categoryOnly = !hitOn && inCategory;
    if (!hitOn && !categoryOnly) continue;

    const phaseW = PHASE_WEIGHT[s.phase] ?? 0;
    if (phaseW <= 0) continue;

    // Velocity, normalised to ~[0,1] (velocities above 100 are already hot).
    const velN = clamp((Number(s.velocity) || 0) / 100, 0, 1);
    // Base per-trend lift: the trend's own measured ER boost if known, else a
    // modest default. Scaled by phase, velocity, and match quality.
    const base = s.avg_er_boost != null && Number.isFinite(Number(s.avg_er_boost))
      ? clamp(Number(s.avg_er_boost), 0, 0.4)
      : 0.10;
    const quality = categoryOnly ? 0.4 : 1.0;
    const contribution = base * phaseW * (0.5 + 0.5 * velN) * quality;
    if (contribution <= 0) continue;

    sumBoost += contribution;
    matched.push({
      trend_type: s.trend_type,
      display_name: s.display_name,
      phase: s.phase,
      velocity: Number(s.velocity) || 0,
      matched_on: hitOn ?? `${cat} niche`,
      boost_pct: Math.round(contribution * 1000) / 10,
    });
  }

  // Strongest trends first; cap the total lift so nothing runs away.
  matched.sort((a, b) => b.boost_pct - a.boost_pct);
  const cappedBoost = clamp(sumBoost, 0, 0.8);
  // No trend alignment at all → slight headwind (content isn't riding anything).
  const multiplier = matched.length === 0 ? 0.95 : 1 + cappedBoost;
  const score = clamp(cappedBoost / 0.8, 0, 1);
  return { multiplier, score, matched: matched.slice(0, 8) };
}

// ── timing ──────────────────────────────────────────────────────────────────
// Rank the creator's day-parts by average ER, then reward/penalise the planned
// slot. Bounded to ±10% so timing never dominates the prediction.
function timingMultiplier(posts: Post[], when: Date): number {
  const dated = posts.filter((p) => p.posted_at);
  if (dated.length < 6) return 1.0;
  const bucketOf = (d: Date) => d.getUTCDay() * 4 + Math.floor(d.getUTCHours() / 6); // 28 buckets (day × 6h part)
  const stat = new Map<number, { n: number; er: number }>();
  for (const p of dated) {
    const d = new Date(p.posted_at!);
    const inter = (p.like_count ?? 0) + (p.comment_count ?? 0);
    const b = bucketOf(d);
    const s = stat.get(b) ?? { n: 0, er: 0 };
    s.n++; s.er += inter; // relative scale is all that matters here
    stat.set(b, s);
  }
  const ranked = [...stat.entries()]
    .filter(([, s]) => s.n >= 1)
    .sort(([, a], [, b]) => (b.er / b.n) - (a.er / a.n))
    .map(([b]) => b);
  if (ranked.length < 3) return 1.0;
  const slot = bucketOf(when);
  const rank = ranked.indexOf(slot);
  if (rank === 0) return 1.10;
  if (rank === 1) return 1.05;
  if (rank >= 0 && rank <= Math.floor(ranked.length / 2)) return 1.0;
  return 0.92; // planned for a historically weak slot
}

function confidenceOf(n: number): InsightConfidence {
  if (n >= 20) return 'high';
  if (n >= 10) return 'medium';
  if (n >= 4) return 'low';
  return 'very_low';
}
const INTERVAL: Record<InsightConfidence, number> = { high: 0.2, medium: 0.35, low: 0.55, very_low: 0.8 };

function bucketOf(predEr: number, baseEr: number): PerformanceBucket {
  if (baseEr <= 0) {
    if (predEr >= 0.08) return 'breakout';
    if (predEr >= 0.04) return 'above_average';
    if (predEr >= 0.02) return 'average';
    return 'below_average';
  }
  const r = predEr / baseEr;
  if (r >= 1.8) return 'breakout';
  if (r >= 1.25) return 'above_average';
  if (r >= 0.75) return 'average';
  return 'below_average';
}

// ── content (vision) helpers ─────────────────────────────────────────────────
const CONTENT_DIMS: Array<{ key: keyof ContentScores; label: string }> = [
  { key: 'hook_strength', label: 'Hook strength' },
  { key: 'retention_design', label: 'Retention' },
  { key: 'information_density', label: 'Info density' },
  { key: 'emotional_trigger', label: 'Emotional pull' },
  { key: 'production_quality', label: 'Production' },
  { key: 'trend_leverage', label: 'Trend leverage' },
  { key: 'brand_integration', label: 'Brand fit' },
  { key: 'cta_effectiveness', label: 'CTA' },
  { key: 'audio_fit', label: 'Audio fit' },
  { key: 'shareability', label: 'Shareability' },
  { key: 'comment_magnetism', label: 'Comment pull' },
  { key: 'niche_authority', label: 'Niche authority' },
];
function rankDims(s: ContentScores, n: number, dir: 'asc' | 'desc'): Array<{ name: string; score: number }> {
  const arr = CONTENT_DIMS.map((d) => ({ name: d.label, score: Math.round((s[d.key] as number) * 100) / 100 }));
  arr.sort((a, b) => (dir === 'desc' ? b.score - a.score : a.score - b.score));
  return arr.slice(0, n);
}

// ── main ─────────────────────────────────────────────────────────────────────
export async function predictReach(args: ReachPredictorArgs): Promise<ReachPrediction | null> {
  const insights = await computeScrapedInsights(args.creator_id);
  if (!insights) return null;

  const followers = insights.follower_count || 0;
  const posts: Post[] = insights.time_series.map((p) => ({
    post_type: p.post_type,
    posted_at: p.posted_at,
    like_count: p.like_count,
    comment_count: p.comment_count,
    view_count: p.view_count,
  }));

  // ── Baselines: prefer posts of the SAME format, fall back to all posts, then
  //    to the creator's stored averages, then to a follower-based estimate. ──
  const sameFmt = posts.filter((p) => formatMatches(p.post_type, args.format));
  const likePool = (sameFmt.filter((p) => (p.like_count ?? 0) > 0).length >= 3 ? sameFmt : posts)
    .map((p) => p.like_count ?? 0).filter((v) => v > 0);
  const commentPool = posts.map((p) => p.comment_count ?? 0).filter((v) => v >= 0);

  const baselineLikes = likePool.length
    ? median(likePool)
    : (insights.avg_likes ?? (followers > 0 && insights.engagement_rate ? followers * insights.engagement_rate * 0.9 : 0));
  const baselineComments = commentPool.length ? median(commentPool) : (insights.avg_comments ?? Math.round(baselineLikes * 0.03));

  // Views only exist for video/reels.
  const viewPool = posts.filter((p) => isVideo(p.post_type)).map((p) => p.view_count ?? 0).filter((v) => v > 0);
  const baselineViews = args.format === 'reel'
    ? (viewPool.length ? median(viewPool) : (insights.avg_views ?? null))
    : null;

  const baselineEr = followers > 0 ? (baselineLikes + baselineComments) / followers : (insights.engagement_rate ?? 0);

  // ── Factors ──
  const tokens = tokenize(args.caption ?? '', args.hashtags ?? []);
  const { multiplier: trend, score: trendScore, matched } = await matchTrends(tokens, insights.primary_category);
  const when = args.post_time ? new Date(args.post_time) : new Date();
  const timing = timingMultiplier(posts, Number.isNaN(when.getTime()) ? new Date() : when);

  // Hand-tuned format lift for LIKES: how this format's likes compare to the
  // creator's overall (bounded). Used as the fallback when no trained model.
  let formatLift = 1.0;
  if (sameFmt.length >= 3 && posts.length >= 5) {
    const fmtMed = median(sameFmt.map((p) => p.like_count ?? 0).filter((v) => v > 0));
    const allMed = median(posts.map((p) => p.like_count ?? 0).filter((v) => v > 0));
    if (fmtMed > 0 && allMed > 0) formatLift = clamp(fmtMed / allMed, 0.7, 1.4);
  }

  // Trained content effect: a ridge model fit on ALL creators' history learns
  // how this format + caption (length, hashtags, emoji, CTA) move a post off
  // the creator's own baseline. When a model is present it supersedes the
  // hand-tuned format lift; otherwise we fall back to it. Trend + timing stay
  // as live signals on top (they can't be learned from old posts).
  const models = await loadReachModels();
  const contentFeat: ContentFeatures = {
    format: args.format,
    caption: args.caption ?? '',
    hashtagCount: (args.hashtags ?? []).length,
  };
  const likesContentMult = models.likes ? likesMultiplier(models.likes, contentFeat) : formatLift;
  const viewsContentMult = models.views ? viewsMultiplier(models.views, contentFeat) : 1.0;

  const combined = trend * timing;
  const conf = confidenceOf(posts.length);
  const iw = INTERVAL[conf];

  // ── Content quality (vision) ──
  // If the caller supplied a draft media / thumbnail URL, score the ACTUAL
  // content with Gemini (which sees the image) and let its quality move the
  // prediction. Entirely optional and best-effort — any failure, or a missing
  // API key, simply leaves the prediction on baseline × trend × timing.
  let contentMult = 1;
  let contentBlock: ReachPrediction['content'] = null;
  const mediaToScore = args.thumbnail_url || args.media_url;
  if (mediaToScore && process.env.GEMINI_API_KEY) {
    try {
      const mediaType = args.format === 'photo' ? 'IMAGE' : args.format === 'carousel' ? 'CAROUSEL_ALBUM' : 'VIDEO';
      const scored = await scoreContent({
        media_url: args.media_url || mediaToScore,
        thumbnail_url: args.thumbnail_url || (args.format !== 'photo' ? args.media_url : undefined),
        media_type: mediaType,
        caption: args.caption,
        creator_category: insights.primary_category ?? undefined,
      });
      const overall = scored.scores.overall_weighted;
      // Neutral quality is ~0.5; good content lifts, weak content dampens.
      contentMult = clamp(1 + (overall - 0.5) * 0.9, 0.75, 1.4);
      contentBlock = {
        scored: true,
        vision: !!scored.vision,
        overall: Math.round(overall * 100) / 100,
        multiplier: Math.round(contentMult * 100) / 100,
        top_dimensions: rankDims(scored.scores, 3, 'desc'),
        weak_dimensions: rankDims(scored.scores, 3, 'asc'),
        suggestions: scored.scores.improvement_suggestions.slice(0, 3),
      };
    } catch (err) {
      console.error('[predict/reach] content scoring failed:', err);
    }
  }

  // ── Predictions ──
  const predictedLikes = Math.round(baselineLikes * combined * likesContentMult * contentMult);
  const predictedComments = Math.round(baselineComments * combined);
  const predictedViews = baselineViews != null ? Math.round(baselineViews * combined * viewsContentMult * contentMult) : null;
  const predictedEr = followers > 0 ? (predictedLikes + predictedComments) / followers : predictedEr0(baselineEr, combined);

  // Ranges: scale the creator's own P25/P75 spread by the same factors, then
  // widen by the confidence band.
  const likeLo = Math.round((likePool.length ? percentile(likePool, 25) : baselineLikes * 0.7) * combined * likesContentMult * contentMult * (1 - iw * 0.4));
  const likeHi = Math.round((likePool.length ? percentile(likePool, 75) : baselineLikes * 1.3) * combined * likesContentMult * contentMult * (1 + iw * 0.6));
  let viewsRange: [number, number] | null = null;
  if (predictedViews != null && baselineViews != null) {
    const vLo = Math.round((viewPool.length ? percentile(viewPool, 25) : baselineViews * 0.7) * combined * viewsContentMult * contentMult * (1 - iw * 0.4));
    const vHi = Math.round((viewPool.length ? percentile(viewPool, 75) : baselineViews * 1.3) * combined * viewsContentMult * contentMult * (1 + iw * 0.6));
    viewsRange = [Math.max(0, vLo), Math.max(vHi, vLo)];
  }

  const notes = buildNotes({
    trend, timing, formatLift: likesContentMult, matched, format: args.format,
    conf, hasViews: baselineViews != null, modelUsed: !!models.likes, content: contentBlock,
  });

  return {
    format: args.format,
    predicted_views: predictedViews,
    predicted_views_range: viewsRange,
    predicted_likes: Math.max(0, predictedLikes),
    predicted_likes_range: [Math.max(0, likeLo), Math.max(likeHi, likeLo)],
    predicted_comments: Math.max(0, predictedComments),
    predicted_er: predictedEr,
    bucket: bucketOf(predictedEr, baselineEr),
    confidence: conf,
    baseline_views: baselineViews != null ? Math.round(baselineViews) : null,
    baseline_likes: Math.round(baselineLikes),
    baseline_er: baselineEr,
    factors: {
      trend: Math.round(trend * 100) / 100,
      timing: Math.round(timing * 100) / 100,
      format: Math.round(likesContentMult * 100) / 100,
      content: Math.round(contentMult * 100) / 100,
    },
    content: contentBlock,
    trend_score: Math.round(trendScore * 100) / 100,
    matched_trends: matched,
    posts_analyzed: posts.length,
    notes,
    model_meta: {
      likes_model: !!models.likes,
      views_model: !!models.views,
      likes_content_multiplier: Math.round(likesContentMult * 100) / 100,
      views_content_multiplier: Math.round(viewsContentMult * 100) / 100,
      trained_at: models.trained_at,
    },
  };
}

// ER fallback when follower count is unknown: nudge the baseline ER by the
// combined multiplier so the bucket still makes sense.
function predictedEr0(baseEr: number, combined: number): number {
  return baseEr * combined;
}

function buildNotes(a: {
  trend: number; timing: number; formatLift: number; matched: MatchedTrend[];
  format: ReachPredictorArgs['format']; conf: InsightConfidence; hasViews: boolean;
  modelUsed: boolean; content: ReachPrediction['content'];
}): string[] {
  const notes: string[] = [];
  if (a.content?.scored) {
    const q = Math.round(a.content.overall * 100);
    const seen = a.content.vision ? 'looked at the media and ' : '';
    if (a.content.multiplier >= 1.05) notes.push(`Content quality is strong (${q}/100) — the model ${seen}lifted the forecast ~${Math.round((a.content.multiplier - 1) * 100)}%. Strongest: ${a.content.top_dimensions.map((d) => d.name.toLowerCase()).join(', ')}.`);
    else if (a.content.multiplier <= 0.95) notes.push(`Content quality is holding it back (${q}/100), trimming ~${Math.round((1 - a.content.multiplier) * 100)}%. Weakest: ${a.content.weak_dimensions.map((d) => d.name.toLowerCase()).join(', ')}.`);
    else notes.push(`Content quality scored ${q}/100 — roughly neutral effect.`);
  }
  if (a.matched.length > 0) {
    const top = a.matched[0]!;
    notes.push(`Riding ${a.matched.length} live trend${a.matched.length > 1 ? 's' : ''} — strongest is “${top.display_name}” (${top.phase}), adding ~${Math.round((a.trend - 1) * 100)}% lift.`);
  } else {
    notes.push('No currently-trending audio, hashtag or topic detected in the caption — add one to ride a trend and lift reach.');
  }
  if (a.timing >= 1.05) notes.push('Planned post time lands in one of this creator’s best-performing slots.');
  else if (a.timing < 1) notes.push('This time slot has historically underperformed for this creator — consider one of their peak windows.');
  if (a.format === 'reel' && !a.hasViews) notes.push('No historical reel view data yet, so the view estimate falls back to stored averages.');
  const Fmt = `${a.format[0]!.toUpperCase()}${a.format.slice(1)}`;
  if (a.modelUsed) {
    if (a.formatLift > 1.05) notes.push(`Trained model: this ${a.format} + caption typically lifts likes ~${Math.round((a.formatLift - 1) * 100)}% above this creator’s baseline.`);
    else if (a.formatLift < 0.95) notes.push(`Trained model: this ${a.format} + caption typically lands ~${Math.round((1 - a.formatLift) * 100)}% below this creator’s baseline — try a stronger hook or a trending format.`);
    else notes.push('Trained model: the content effect is roughly neutral vs this creator’s baseline.');
  } else {
    if (a.formatLift > 1.05) notes.push(`${Fmt}s outperform this creator’s other formats.`);
    else if (a.formatLift < 0.95) notes.push(`${Fmt}s tend to underperform this creator’s other formats.`);
  }
  if (a.conf === 'low' || a.conf === 'very_low') notes.push('Limited post history — treat this as a rough estimate; it sharpens as more posts are analysed.');
  return notes;
}
