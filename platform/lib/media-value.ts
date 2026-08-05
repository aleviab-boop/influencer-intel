// ============================================================
// Earned Media Value (EMV) — the dollar-equivalent worth of a creator's
// organic output. Brands use EMV to compare influencer marketing against paid
// media; creators use it to justify their rates ("my last month of posts was
// worth ~₹X in equivalent ad spend").
//
// TRANSPARENT model, clearly labelled as an estimate:
//   • Reach value      = impressions × (CPM ÷ 1000)     — what that reach would
//                        cost as paid media, by tier CPM.
//   • Engagement value = engagements × value-per-engagement — earned actions are
//                        worth more than a passive impression, so we add this.
//   • Per-post EMV     = reach value + engagement value.
//   • Monthly EMV      = per-post EMV × posts/month (from cadence).
//
// All inputs come from stats the analytics route already computed — no extra
// Graph calls, no new tables.
// ============================================================

export type ValueTier = 'nano' | 'micro' | 'mid' | 'macro' | 'mega';

export interface MediaValue {
  available: boolean;
  currency: 'INR';
  tier: ValueTier;
  // Per-post earned media value range (low/high around a midpoint).
  per_post_low: number;
  per_post_mid: number;
  per_post_high: number;
  // Monthly, using posting cadence (null if cadence unknown).
  monthly_mid: number | null;
  posts_per_month: number | null;
  // The building blocks, surfaced so the number is defensible.
  reach_value: number;        // per-post, from impressions × CPM
  engagement_value: number;   // per-post, from engagements × value/eng
  avg_impressions: number;    // reach basis used
  avg_engagements: number;    // likes + comments + saves + shares basis
  cpm: number;                // ₹ CPM used for the tier
  note: string;
}

// ₹ CPM (cost per 1,000 impressions) as equivalent paid-media spend, by tier.
// Larger, more premium audiences carry a higher effective CPM.
const CPM_BY_TIER: Record<ValueTier, number> = {
  nano: 120, micro: 180, mid: 260, macro: 380, mega: 550,
};

// ₹ value of a single earned engagement (like/comment/save/share). Saves and
// shares are worth more than likes, but we blend to one figure for simplicity
// and lean conservative.
const VALUE_PER_ENGAGEMENT = 2.5;

function tierFor(followers: number): ValueTier {
  if (followers < 10_000) return 'nano';
  if (followers < 50_000) return 'micro';
  if (followers < 500_000) return 'mid';
  if (followers < 1_000_000) return 'macro';
  return 'mega';
}

function roundNice(v: number): number {
  if (v <= 0) return 0;
  if (v < 2_000) return Math.round(v / 100) * 100;
  if (v < 20_000) return Math.round(v / 500) * 500;
  return Math.round(v / 1_000) * 1_000;
}

export interface MediaValueInput {
  followers: number | null | undefined;
  avg_reach: number | null | undefined;       // per-post reach/impressions
  avg_likes: number | null | undefined;
  avg_comments: number | null | undefined;
  avg_saves?: number | null;                   // optional (from enriched posts)
  avg_shares?: number | null;
  posts_per_week: number | null | undefined;
}

/**
 * Estimate earned media value. Needs followers and some reach signal; falls
 * back to a reach proxy (followers × a coverage factor) when per-post reach is
 * missing, so newly-connected accounts still get a directional number.
 */
export function estimateMediaValue(input: MediaValueInput): MediaValue {
  const followers = Number(input.followers);
  const empty: MediaValue = {
    available: false, currency: 'INR', tier: 'nano',
    per_post_low: 0, per_post_mid: 0, per_post_high: 0,
    monthly_mid: null, posts_per_month: null,
    reach_value: 0, engagement_value: 0, avg_impressions: 0, avg_engagements: 0,
    cpm: 0, note: '',
  };
  if (!Number.isFinite(followers) || followers <= 0) return empty;

  const tier = tierFor(followers);
  const cpm = CPM_BY_TIER[tier];

  // Reach basis: real per-post reach if we have it, else a coverage proxy.
  // Organic reach typically lands around a fraction of followers.
  const realReach = Number(input.avg_reach);
  const impressions = Number.isFinite(realReach) && realReach > 0
    ? realReach
    : Math.round(followers * 0.30); // conservative coverage proxy

  const engagements = Math.max(
    0,
    (Number(input.avg_likes) || 0) + (Number(input.avg_comments) || 0)
      + (Number(input.avg_saves) || 0) + (Number(input.avg_shares) || 0),
  );

  const reachValue = (impressions / 1000) * cpm;
  const engagementValue = engagements * VALUE_PER_ENGAGEMENT;
  const perPostMid = reachValue + engagementValue;

  const perWeek = Number(input.posts_per_week);
  const postsPerMonth = Number.isFinite(perWeek) && perWeek > 0
    ? Math.round(perWeek * 4.33 * 10) / 10
    : null;
  const monthlyMid = postsPerMonth != null ? perPostMid * postsPerMonth : null;

  return {
    available: perPostMid > 0,
    currency: 'INR',
    tier,
    per_post_low: roundNice(perPostMid * 0.75),
    per_post_mid: roundNice(perPostMid),
    per_post_high: roundNice(perPostMid * 1.35),
    monthly_mid: monthlyMid != null ? roundNice(monthlyMid) : null,
    posts_per_month: postsPerMonth,
    reach_value: Math.round(reachValue),
    engagement_value: Math.round(engagementValue),
    avg_impressions: Math.round(impressions),
    avg_engagements: Math.round(engagements),
    cpm,
    note: Number.isFinite(realReach) && realReach > 0
      ? 'Estimated equivalent ad-spend value of your organic reach + engagement. Directional, not a guaranteed figure.'
      : 'Reach estimated from your follower count (per-post reach not available yet). Directional estimate.',
  };
}
