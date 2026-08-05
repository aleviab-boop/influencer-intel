// ============================================================
// Audience quality / authenticity signals.
//
// A TRANSPARENT heuristic — not a verdict. We can't see a follower list, but
// genuine audiences leave fingerprints in engagement: a healthy engagement
// rate for the account's size, people actually commenting (not just liking),
// engagement that varies naturally post-to-post, and content that reaches
// beyond the follower count. Each signal is scored 0–100 with a plain-English
// reason, then blended into an overall score. Everything is derived from the
// posts we already fetched — no extra Graph calls.
// ============================================================

export interface QualitySignal {
  key: 'engagement' | 'comments' | 'consistency' | 'reach';
  label: string;
  score: number;               // 0..100
  status: 'healthy' | 'watch' | 'concern';
  detail: string;
}
export interface AudienceQuality {
  available: boolean;
  score: number | null;        // 0..100 composite
  grade: string | null;
  sample: number;              // posts used
  signals: QualitySignal[];
}

export interface QualityPost {
  media_type: string;
  like_count: number;
  comments_count: number;
  er: number | null;
  reach: number | null;
}

const clamp = (v: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, v));
const mean = (n: number[]): number => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : 0);
function stdev(n: number[]): number {
  if (n.length < 2) return 0;
  const m = mean(n);
  return Math.sqrt(n.reduce((s, v) => s + (v - m) ** 2, 0) / (n.length - 1));
}

// Typical engagement-rate band by follower tier (Indian IG, fraction).
function expectedEr(followers: number): { lo: number; hi: number } {
  if (followers < 10_000) return { lo: 0.035, hi: 0.09 };
  if (followers < 50_000) return { lo: 0.025, hi: 0.06 };
  if (followers < 500_000) return { lo: 0.015, hi: 0.04 };
  if (followers < 1_000_000) return { lo: 0.01, hi: 0.03 };
  return { lo: 0.008, hi: 0.022 };
}

const statusFor = (score: number): QualitySignal['status'] =>
  score >= 70 ? 'healthy' : score >= 45 ? 'watch' : 'concern';

/**
 * Compute audience-quality signals from a creator's followers + recent posts.
 * Needs at least 4 posts; otherwise returns `available:false`.
 */
export function audienceQuality(followers: number | null | undefined, posts: QualityPost[]): AudienceQuality {
  const f = Number(followers);
  const usable = posts.filter((p) => p.like_count >= 0);
  if (!Number.isFinite(f) || f <= 0 || usable.length < 4) {
    return { available: false, score: null, grade: null, sample: usable.length, signals: [] };
  }

  const ers = usable.map((p) => p.er).filter((v): v is number => v != null && v > 0);
  const avgEr = mean(ers);
  const { lo, hi } = expectedEr(f);

  // 1) Engagement health — where their ER sits vs the expected band.
  //    Below band → low score; within/above → high (capped, extreme highs are
  //    fine but we don't over-reward possible pods).
  let engScore: number;
  if (avgEr <= 0) engScore = 20;
  else if (avgEr < lo) engScore = clamp(40 * (avgEr / lo));            // 0..40 ramp
  else if (avgEr <= hi) engScore = clamp(70 + 30 * ((avgEr - lo) / (hi - lo))); // 70..100
  else engScore = clamp(100 - 12 * ((avgEr - hi) / hi));               // gently taper very high ER
  const engSignal: QualitySignal = {
    key: 'engagement', label: 'Engagement health',
    score: Math.round(engScore), status: statusFor(engScore),
    detail: `${(avgEr * 100).toFixed(2)}% avg engagement vs a typical ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}% for this size.`,
  };

  // 2) Comment ratio — real audiences comment, not just tap like.
  const totalLikes = usable.reduce((s, p) => s + (p.like_count || 0), 0);
  const totalComments = usable.reduce((s, p) => s + (p.comments_count || 0), 0);
  const cRatio = totalLikes > 0 ? totalComments / totalLikes : 0;
  // Healthy roughly 1–6%. Ramp up to ~2%, plateau, gently penalise near-zero.
  const cScore = clamp(cRatio <= 0 ? 15 : cRatio >= 0.02 ? clamp(80 + 20 * Math.min(1, (cRatio - 0.02) / 0.04))
    : 30 + (cRatio / 0.02) * 50);
  const cSignal: QualitySignal = {
    key: 'comments', label: 'Comment ratio',
    score: Math.round(cScore), status: statusFor(cScore),
    detail: `${(cRatio * 100).toFixed(2)}% of likes also comment — genuine audiences tend to sit around 1–6%.`,
  };

  // 3) Consistency — natural variation in ER. Too erratic OR suspiciously flat
  //    both read as odd; a moderate coefficient of variation is healthiest.
  const cv = ers.length >= 2 && avgEr > 0 ? stdev(ers) / avgEr : 0.4;
  // Best around 0.2–0.7. Penalise <0.1 (flat) and >1.2 (erratic).
  let consScore: number;
  if (cv >= 0.2 && cv <= 0.7) consScore = 90;
  else if (cv < 0.2) consScore = clamp(55 + (cv / 0.2) * 35);
  else consScore = clamp(90 - (cv - 0.7) * 70);
  const consSignal: QualitySignal = {
    key: 'consistency', label: 'Engagement consistency',
    score: Math.round(consScore), status: statusFor(consScore),
    detail: cv < 0.15 ? 'Engagement is unusually uniform post-to-post.'
      : cv > 1 ? 'Engagement swings a lot between posts.'
      : 'Engagement varies naturally across posts — a healthy sign.',
  };

  const signals: QualitySignal[] = [engSignal, cSignal, consSignal];

  // 4) Reach efficiency (informational) — only when reach data exists.
  const reaches = usable.map((p) => p.reach).filter((v): v is number => v != null && v > 0);
  if (reaches.length >= 3) {
    const reachRatio = mean(reaches) / f; // reach per post ÷ followers
    // ~0.3+ is strong distribution; scale.
    const rScore = clamp(reachRatio >= 0.5 ? 95 : 45 + (reachRatio / 0.5) * 50);
    signals.push({
      key: 'reach', label: 'Reach efficiency',
      score: Math.round(rScore), status: statusFor(rScore),
      detail: `Posts reach ~${Math.round(reachRatio * 100)}% of your follower count on average.`,
    });
  }

  // Weighted composite (reach is a lighter, bonus signal).
  const weights: Record<QualitySignal['key'], number> = { engagement: 0.4, comments: 0.3, consistency: 0.2, reach: 0.1 };
  let wSum = 0, acc = 0;
  for (const s of signals) { acc += s.score * weights[s.key]; wSum += weights[s.key]; }
  const score = Math.round(acc / (wSum || 1));
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 55 ? 'Fair' : 'Needs attention';

  return { available: true, score, grade, sample: usable.length, signals };
}
