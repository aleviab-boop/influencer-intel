// ============================================================
// Tier-climb planner — the growth projection says "you'll cross the next nice
// round number in N days"; this reframes the same pace around the NAMED creator
// tiers brands actually bracket by (nano → micro → mid-tier → macro → mega) and
// answers the question that follows: what's the next tier, when do I reach it at
// my current pace, and what does crossing it unlock on my rate card. It turns an
// abstract follower count into a commercial milestone with a date and a number.
//
// Pure and deterministic: it reuses the same tier thresholds as the rate card
// and peer benchmark, and a transparent per-post rate proxy (₹ per 1k followers
// by tier, adjusted for engagement). No ML, no LLM. The ETA assumes the recent
// pace holds — directional, and labelled as such.
// ============================================================

export interface TierClimbInput {
  followers: number | null;
  daily_rate: number | null;   // avg followers/day, from the growth projection (can be ≤ 0)
  avg_er: number | null;       // engagement rate as a fraction, e.g. 0.042
}

export interface TierClimb {
  available: boolean;
  current_tier: string;
  current_followers: number;
  progress_pct: number | null;         // how far through the current tier band (0–100)
  next_tier: string | null;            // null → already at the top tier
  next_threshold: number | null;
  followers_to_go: number | null;
  daily_rate: number | null;
  eta_days: number | null;             // null if flat/declining or already top tier
  eta_date: string | null;             // YYYY-MM-DD
  eta_label: string | null;            // "~4 months"
  rate_uplift_pct: number | null;      // per-post rate lift unlocked at the next tier
  headline: string | null;
  tip: string | null;
}

interface Band { key: string; label: string; lo: number; hi: number | null; per1k: number }
// Thresholds mirror peer-benchmark / media-kit so tier labels stay consistent.
// per1k = ₹ per 1,000 followers for a single static post at that tier.
const BANDS: Band[] = [
  { key: 'nano', label: 'Nano', lo: 0, hi: 10_000, per1k: 150 },
  { key: 'micro', label: 'Micro', lo: 10_000, hi: 50_000, per1k: 250 },
  { key: 'mid', label: 'Mid-tier', lo: 50_000, hi: 500_000, per1k: 400 },
  { key: 'macro', label: 'Macro', lo: 500_000, hi: 1_000_000, per1k: 700 },
  { key: 'mega', label: 'Mega', lo: 1_000_000, hi: null, per1k: 1200 },
];

const DAY_MS = 86_400_000;

function bandFor(f: number): Band {
  return BANDS.find((b) => f >= b.lo && (b.hi == null || f < b.hi)) ?? BANDS[BANDS.length - 1]!;
}

// Engagement quality multiplier — same shape as the rate card.
function erMult(er: number | null): number {
  const e = Number(er);
  if (!Number.isFinite(e)) return 1;
  return e >= 0.06 ? 1.35 : e >= 0.03 ? 1.15 : e >= 0.015 ? 1.0 : 0.8;
}

// Transparent per-post static-rate proxy at a given follower count.
function perPost(followers: number, er: number | null): number {
  return (followers / 1000) * bandFor(followers).per1k * erMult(er);
}

function addDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

function humanDuration(days: number): string {
  if (days <= 14) return '~2 weeks';
  if (days < 45) return `~${Math.round(days / 7)} weeks`;
  if (days < 365) return `~${Math.max(1, Math.round(days / 30))} month${Math.round(days / 30) === 1 ? '' : 's'}`;
  const yrs = days / 365;
  return `~${yrs.toFixed(yrs < 2 ? 1 : 0)} year${yrs >= 2 ? 's' : ''}`;
}

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n % 1_000 === 0 ? String(n / 1_000) : (n / 1_000).toFixed(1)) + 'K';
  return String(n);
}

export function planTierClimb(input: TierClimbInput): TierClimb {
  const followers = Number(input.followers);
  const empty: TierClimb = {
    available: false, current_tier: '', current_followers: 0, progress_pct: null,
    next_tier: null, next_threshold: null, followers_to_go: null, daily_rate: null,
    eta_days: null, eta_date: null, eta_label: null, rate_uplift_pct: null,
    headline: null, tip: null,
  };
  if (!Number.isFinite(followers) || followers <= 0) return empty;

  const band = bandFor(followers);
  const idx = BANDS.indexOf(band);
  const next = band.hi != null ? BANDS[idx + 1] ?? null : null;

  // Progress through the current band (mega has no ceiling → null).
  const progress_pct = band.hi != null
    ? Math.max(0, Math.min(100, Math.round(((followers - band.lo) / (band.hi - band.lo)) * 100)))
    : null;

  // Already at the top tier — celebrate and stop.
  if (!next || band.hi == null) {
    return {
      ...empty, available: true, current_tier: band.label, current_followers: followers,
      progress_pct, next_tier: null, next_threshold: null, followers_to_go: null,
      daily_rate: input.daily_rate ?? null,
      headline: `You're a ${band.label.toLowerCase()} creator — the top follower tier. Focus on engagement and rate, not milestones.`,
      tip: 'At this scale, per-post rate is driven by engagement quality and usage rights far more than raw follower count.',
    };
  }

  const threshold = band.hi;                     // == next.lo
  const toGo = Math.max(0, threshold - followers);
  const rate = input.daily_rate;
  const growing = rate != null && Number.isFinite(rate) && rate > 0;

  let eta_days: number | null = null;
  let eta_date: string | null = null;
  let eta_label: string | null = null;
  if (growing && toGo > 0) {
    eta_days = Math.ceil(toGo / (rate as number));
    eta_date = addDays(eta_days);
    eta_label = humanDuration(eta_days);
  }

  // Commercial uplift: per-post rate at the threshold vs now (same ER assumed).
  const now = perPost(followers, input.avg_er);
  const at = perPost(threshold, input.avg_er);
  const rate_uplift_pct = now > 0 ? Math.round(((at - now) / now) * 100) : null;

  const upliftClause = rate_uplift_pct != null && rate_uplift_pct > 0
    ? ` — crossing into ${next.label.toLowerCase()} typically lifts your per-post rate by ~${rate_uplift_pct}%`
    : '';
  const headline = growing && eta_label
    ? `${fmtFollowers(toGo)} more to ${next.label.toLowerCase()} (${fmtFollowers(threshold)}) — about ${eta_label} at your current pace${upliftClause}.`
    : `${fmtFollowers(toGo)} more followers to reach ${next.label.toLowerCase()} (${fmtFollowers(threshold)})${upliftClause}.`;

  const tip = growing
    ? `Keep your posting cadence steady and you'll cross ${fmtFollowers(threshold)} around ${eta_date}. Brands bracket by tier, so hitting it is a real rate unlock — update your media kit the week you do.`
    : `Your follower count is flat or slipping, so there's no ETA yet. Lift your posting consistency and reach first — growth is the input, the tier milestone is the output.`;

  return {
    available: true,
    current_tier: band.label,
    current_followers: followers,
    progress_pct,
    next_tier: next.label,
    next_threshold: threshold,
    followers_to_go: toGo,
    daily_rate: rate ?? null,
    eta_days,
    eta_date,
    eta_label,
    rate_uplift_pct,
    headline,
    tip,
  };
}
