// ============================================================
// Suggested rate card for a creator's media kit.
//
// This is a TRANSPARENT market heuristic, not a quote. Indian influencer
// pricing roughly tracks reach (followers) scaled by engagement quality, with
// a per-format multiplier (reels > carousels > static > stories). We surface
// RANGES and label them clearly as starting points — a creator negotiates up
// from here, a brand sanity-checks down.
// ============================================================

export type Tier = 'nano' | 'micro' | 'mid' | 'macro' | 'mega';

export interface RateItem { label: string; low: number; high: number }
export interface RateCard {
  currency: 'INR';
  tier: Tier;
  tier_label: string;
  items: RateItem[];
  note: string;
}

// ₹ per 1,000 followers for a single static post, by follower tier. Bigger
// accounts command more absolute reach spend; engagement then adjusts it.
const BASE_PER_1K: Record<Tier, number> = {
  nano: 150, micro: 250, mid: 400, macro: 700, mega: 1200,
};
const TIER_LABEL: Record<Tier, string> = {
  nano: 'Nano', micro: 'Micro', mid: 'Mid-tier', macro: 'Macro', mega: 'Mega',
};

function tierFor(followers: number): Tier {
  if (followers < 10_000) return 'nano';
  if (followers < 50_000) return 'micro';
  if (followers < 500_000) return 'mid';
  if (followers < 1_000_000) return 'macro';
  return 'mega';
}

// Round to a clean, negotiable-looking figure.
function roundNice(v: number): number {
  if (v <= 0) return 0;
  if (v < 2_000) return Math.round(v / 100) * 100;
  if (v < 20_000) return Math.round(v / 500) * 500;
  return Math.round(v / 1_000) * 1_000;
}

/**
 * Suggest a rate card from followers + average engagement rate (fraction,
 * e.g. 0.042 for 4.2%). Returns null if followers are unknown/zero.
 */
export function suggestRateCard(followers: number | null | undefined, avgEr: number | null | undefined): RateCard | null {
  const f = Number(followers);
  if (!Number.isFinite(f) || f <= 0) return null;

  const tier = tierFor(f);
  const er = Number(avgEr);
  // Engagement quality multiplier.
  const m = !Number.isFinite(er) ? 1
    : er >= 0.06 ? 1.35
    : er >= 0.03 ? 1.15
    : er >= 0.015 ? 1.0
    : 0.8;

  const postBase = (f / 1000) * BASE_PER_1K[tier] * m;
  const formats: { label: string; mult: number }[] = [
    { label: 'Reel', mult: 1.5 },
    { label: 'Static post', mult: 1.0 },
    { label: 'Carousel', mult: 1.2 },
    { label: 'Story (per frame)', mult: 0.4 },
  ];

  const items: RateItem[] = formats.map(({ label, mult }) => {
    const mid = postBase * mult;
    return { label, low: roundNice(mid * 0.8), high: roundNice(mid * 1.25) };
  });

  return {
    currency: 'INR',
    tier,
    tier_label: TIER_LABEL[tier],
    items,
    note: 'Suggested starting rates, estimated from your reach and engagement. Actual pricing varies by niche, usage rights, exclusivity and deliverables.',
  };
}
