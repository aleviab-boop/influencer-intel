// ============================================================
// Posting consistency — is the creator showing up on a steady rhythm?
//
// Cadence (posts/week) already tells you HOW MUCH someone posts; this tells you
// how RELIABLY. The IG algorithm and an audience both reward regularity, so we
// score the *rhythm*: how even the gaps between posts are, the current active
// streak, the longest silent gap, and whether the pace is speeding up or
// slipping. Then — since consistency is only worth chasing if it pays — we
// check whether the creator's steadier stretches actually engage better.
//
// Pure and deterministic: everything derives from post timestamps (+ ER) the
// route already fetched. No ML, no network. Directional on a small sample.
// ============================================================

export interface CadencePost {
  timestamp: string;   // ISO, UTC
  er: number | null;
}

export interface PostingConsistency {
  available: boolean;
  sample_size: number;
  span_days: number;
  posts_per_week: number | null;
  avg_gap_days: number | null;       // mean days between consecutive posts
  regularity_pct: number | null;     // 0–100; higher = more even spacing
  current_streak_weeks: number;      // consecutive recent weeks with ≥1 post
  longest_gap_days: number | null;   // biggest silence between posts
  days_since_last: number | null;
  momentum: 'accelerating' | 'steady' | 'slowing' | null;
  score: number;                     // 0–100 overall consistency
  grade: 'excellent' | 'good' | 'fair' | 'inconsistent';
  headline: string | null;
  tip: string | null;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MIN_SAMPLE = 5;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function analyzePostingConsistency(posts: CadencePost[], now: number = Date.now()): PostingConsistency {
  const times = posts
    .map((p) => new Date(p.timestamp).getTime())
    .filter((t) => Number.isFinite(t) && t <= now)
    .sort((a, b) => a - b);   // chronological

  const empty: PostingConsistency = {
    available: false, sample_size: times.length, span_days: 0,
    posts_per_week: null, avg_gap_days: null, regularity_pct: null,
    current_streak_weeks: 0, longest_gap_days: null, days_since_last: null,
    momentum: null, score: 0, grade: 'inconsistent', headline: null, tip: null,
  };
  if (times.length < MIN_SAMPLE) return empty;

  const first = times[0]!;
  const last = times[times.length - 1]!;
  const spanMs = last - first;
  if (spanMs <= 0) return empty;
  const spanDays = spanMs / DAY_MS;

  // ---- Gaps between consecutive posts ------------------------------------
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i]! - times[i - 1]!) / DAY_MS);
  const avgGap = gaps.reduce((s, v) => s + v, 0) / gaps.length;
  const longestGap = Math.max(...gaps);
  const postsPerWeek = round1((times.length / spanDays) * 7);

  // Regularity = how even the spacing is. Coefficient of variation of the gaps
  // (std / mean); 0 CV → perfectly even → 100%. Clamp the mapping so a CV of ~1
  // (very erratic) lands near 0.
  const variance = gaps.reduce((s, v) => s + (v - avgGap) * (v - avgGap), 0) / gaps.length;
  const cv = avgGap > 0 ? Math.sqrt(variance) / avgGap : 1;
  const regularity = Math.round(Math.max(0, Math.min(1, 1 - cv)) * 100);

  // ---- Current active streak (consecutive recent weeks with ≥1 post) ------
  // Walk back week-by-week from now; stop at the first empty week.
  let streak = 0;
  for (let w = 0; w < 52; w++) {
    const hiEnd = now - w * WEEK_MS;
    const loEnd = hiEnd - WEEK_MS;
    const hit = times.some((t) => t > loEnd && t <= hiEnd);
    if (hit) streak++;
    else break;
  }

  const daysSinceLast = Math.floor((now - last) / DAY_MS);

  // ---- Momentum: recent-half cadence vs older-half -----------------------
  const mid = first + spanMs / 2;
  const olderCount = times.filter((t) => t <= mid).length;
  const recentCount = times.length - olderCount;
  const halfWeeks = spanDays / 2 / 7;
  const olderRate = halfWeeks > 0 ? olderCount / halfWeeks : 0;
  const recentRate = halfWeeks > 0 ? recentCount / halfWeeks : 0;
  let momentum: PostingConsistency['momentum'] = 'steady';
  if (olderRate > 0) {
    const delta = (recentRate - olderRate) / olderRate;
    momentum = delta > 0.2 ? 'accelerating' : delta < -0.2 ? 'slowing' : 'steady';
  }

  // ---- Overall score -----------------------------------------------------
  // Blend regularity (spacing evenness) with recency (are they still active?).
  // A long silence since the last post drags the score down hard.
  const expectedGap = avgGap > 0 ? avgGap : 7;
  const recencyPenalty = Math.max(0, Math.min(1, (daysSinceLast - expectedGap) / (expectedGap * 2)));
  const score = Math.round(Math.max(0, Math.min(100, regularity * (1 - 0.5 * recencyPenalty))));
  const grade: PostingConsistency['grade'] =
    score >= 75 ? 'excellent' : score >= 55 ? 'good' : score >= 35 ? 'fair' : 'inconsistent';

  // ---- Narrative ---------------------------------------------------------
  const cadenceWord =
    postsPerWeek >= 5 ? 'near-daily' : postsPerWeek >= 3 ? 'several times a week'
      : postsPerWeek >= 1 ? 'about weekly' : 'less than weekly';

  let headline: string;
  if (grade === 'excellent') {
    headline = `You post on a steady ${cadenceWord} rhythm${streak > 1 ? ` — ${streak} weeks running` : ''}. Consistency like this is what the algorithm rewards.`;
  } else if (grade === 'good') {
    headline = `A fairly reliable ${cadenceWord} cadence${streak > 1 ? ` (${streak}-week streak)` : ''} — tightening the gaps would push it further.`;
  } else if (grade === 'fair') {
    headline = `Your posting is uneven — long gaps break the rhythm your audience settles into.`;
  } else {
    headline = `Posting is sporadic${daysSinceLast > expectedGap * 1.5 ? `, and it's been ${daysSinceLast} days since your last post` : ''} — a steady cadence is the fastest lever you control.`;
  }

  let tip: string;
  if (momentum === 'slowing' || daysSinceLast > expectedGap * 1.5) {
    tip = `Get back on schedule: aim for one post every ${Math.max(1, Math.round(expectedGap))} day${Math.round(expectedGap) === 1 ? '' : 's'} to rebuild momentum.`;
  } else if (regularity < 50) {
    tip = `Pick 2–3 fixed slots a week and stick to them — even spacing beats bursts followed by silence.`;
  } else if (grade === 'excellent') {
    tip = `You've nailed cadence — now pour the energy into the content itself, not just showing up.`;
  } else {
    tip = `Hold this rhythm for a few more weeks; steady beats occasional for compounding reach.`;
  }

  return {
    available: true,
    sample_size: times.length,
    span_days: Math.round(spanDays),
    posts_per_week: postsPerWeek,
    avg_gap_days: round1(avgGap),
    regularity_pct: regularity,
    current_streak_weeks: streak,
    longest_gap_days: round1(longestGap),
    days_since_last: daysSinceLast,
    momentum,
    score,
    grade,
    headline,
    tip,
  };
}
