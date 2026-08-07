// ============================================================
// Rate card — brands ask "what do you charge?" and most creators freeze or
// undersell because they have no anchored number. This turns a creator's own
// reach (follower_count) and engagement into a defensible price per deliverable
// — Reel, Feed post, Story set, Carousel, UGC — that they can publish and send.
// Rates are SUGGESTED from a transparent per-1,000-follower formula (nudged by
// engagement vs a benchmark), and the creator can override any of them; their
// overrides are what the card shows.
//
// Pure and deterministic: given the creator's stats and their stored overrides,
// the same card comes out every time — no ML/LLM, no writes. The route persists
// overrides into creator_prefs.rate_card and re-derives; this module only
// computes. All amounts are whole INR; the page formats them.
// ============================================================

export type RateItemKey = 'reel' | 'feed_post' | 'story_set' | 'carousel' | 'ugc';

export interface RateCardStored {
  // Per-item override in whole INR (null/absent = use suggested).
  rates?: Partial<Record<RateItemKey, number | null>>;
  // Per-item enable flag (absent = enabled by default).
  enabled?: Partial<Record<RateItemKey, boolean>>;
  note?: string | null;
}

export interface RateCardInput {
  follower_count: number;
  engagement_rate: number;      // percent, e.g. 3.2
  stored: RateCardStored | null;
}

export interface RateItem {
  key: RateItemKey;
  label: string;
  blurb: string;
  suggested: number;   // formula baseline
  rate: number;        // effective (override ?? suggested)
  custom: boolean;     // creator overrode the suggestion
  enabled: boolean;
}
export interface RatePackage {
  key: string;
  label: string;
  contents: string;
  list_total: number;  // sum of item rates before bundle discount
  price: number;       // discounted bundle price
  saving: number;
}
export interface RateCard {
  available: boolean;
  currency: 'INR';
  follower_count: number;
  engagement_rate: number;
  tier: 'nano' | 'micro' | 'mid' | 'macro' | 'mega';
  tier_label: string;
  has_custom: boolean;
  items: RateItem[];        // enabled + disabled, in display order
  packages: RatePackage[];  // derived from enabled items
  note: string | null;
  headline: string;
  basis: string;            // one-line explanation of the suggestion basis
}

// Base rate per 1,000 followers, by deliverable. Reels command the most,
// stories the least — standard Indian creator-market shape.
const PER_1K: Record<RateItemKey, number> = {
  reel: 150,
  feed_post: 100,
  carousel: 120,
  story_set: 45,   // a set of ~3 stories
  ugc: 90,         // usage-only content, no posting on the creator's grid
};
const META: Record<RateItemKey, { label: string; blurb: string }> = {
  reel: { label: 'Instagram Reel', blurb: 'One scripted Reel, posted to your grid' },
  feed_post: { label: 'Feed post', blurb: 'A single in-feed photo post with caption' },
  carousel: { label: 'Carousel', blurb: 'Multi-slide in-feed post (up to 10 slides)' },
  story_set: { label: 'Story set', blurb: 'A set of 3 stories with link/sticker' },
  ugc: { label: 'UGC (usage only)', blurb: 'Content shot for the brand, not posted on your grid' },
};
const ORDER: RateItemKey[] = ['reel', 'carousel', 'feed_post', 'story_set', 'ugc'];

const ENGAGEMENT_BENCHMARK = 2.5; // percent; above this earns a premium, below a discount

function tierOf(followers: number): { tier: RateCard['tier']; label: string } {
  if (followers >= 1_000_000) return { tier: 'mega', label: 'Mega creator' };
  if (followers >= 500_000) return { tier: 'macro', label: 'Macro creator' };
  if (followers >= 100_000) return { tier: 'mid', label: 'Mid-tier creator' };
  if (followers >= 10_000) return { tier: 'micro', label: 'Micro creator' };
  return { tier: 'nano', label: 'Nano creator' };
}

// Round to a clean, quotable number: nearest 100 under 10k, nearest 500 under
// 1L, nearest 1000 above.
function roundNice(n: number): number {
  if (n <= 0) return 0;
  if (n < 10_000) return Math.round(n / 100) * 100;
  if (n < 100_000) return Math.round(n / 500) * 500;
  return Math.round(n / 1_000) * 1_000;
}

export function buildRateCard(input: RateCardInput): RateCard {
  const followers = Math.max(0, Math.round(Number(input.follower_count) || 0));
  const er = Math.max(0, Number(input.engagement_rate) || 0);
  const stored = input.stored ?? {};
  const storedRates = stored.rates ?? {};
  const storedEnabled = stored.enabled ?? {};

  const { tier, label: tierLabel } = tierOf(followers);

  // Engagement multiplier: clamp to a sane 0.8–1.4 band so one outlier month
  // can't 3× the quote.
  const engMult = followers > 0
    ? Math.max(0.8, Math.min(1.4, er > 0 ? 0.8 + (er / ENGAGEMENT_BENCHMARK) * 0.4 : 1))
    : 1;

  const items: RateItem[] = ORDER.map((key) => {
    const per1k = PER_1K[key];
    const raw = (followers / 1000) * per1k * engMult;
    // Floor so nano creators still quote something credible.
    const suggested = roundNice(Math.max(key === 'story_set' ? 800 : 1500, raw));
    const override = storedRates[key];
    const custom = typeof override === 'number' && override >= 0;
    const rate = custom ? Math.round(override as number) : suggested;
    const enabled = storedEnabled[key] !== false;
    return { key, label: META[key].label, blurb: META[key].blurb, suggested, rate, custom, enabled };
  });

  const enabledItems = items.filter((i) => i.enabled);
  const byKey = new Map(items.map((i) => [i.key, i] as const));

  // Derive up to two bundle packages from what's enabled, with a modest discount.
  const packages: RatePackage[] = [];
  const mk = (key: string, label: string, contents: string, parts: number[], discountPct: number): void => {
    const listTotal = parts.reduce((s, n) => s + n, 0);
    if (listTotal <= 0) return;
    const price = roundNice(listTotal * (1 - discountPct / 100));
    packages.push({ key, label, contents, list_total: listTotal, price, saving: Math.max(0, listTotal - price) });
  };
  const reel = byKey.get('reel');
  const story = byKey.get('story_set');
  const post = byKey.get('feed_post');
  if (reel?.enabled && story?.enabled) {
    mk('launch', 'Launch package', '1 Reel + 1 Story set', [reel.rate, story.rate], 10);
  }
  if (reel?.enabled && post?.enabled && story?.enabled) {
    mk('always_on', 'Always-on (monthly)', '2 Reels + 1 Feed post + 2 Story sets',
      [reel.rate * 2, post.rate, story.rate * 2], 15);
  }

  const hasCustom = items.some((i) => i.custom);
  const cheapest = enabledItems.length ? Math.min(...enabledItems.map((i) => i.rate)) : 0;

  const headline = enabledItems.length === 0
    ? 'No deliverables enabled — turn some on to publish your rate card.'
    : `Starting at \u20b9${cheapest.toLocaleString('en-IN')} · ${enabledItems.length} deliverable${enabledItems.length === 1 ? '' : 's'} priced.`;

  const basis = followers > 0
    ? `Suggested from ${followers.toLocaleString('en-IN')} followers${er > 0 ? ` and ${er.toFixed(1)}% engagement` : ''}. Adjust anything that doesn\u2019t fit.`
    : 'Connect your Instagram stats for tailored suggestions — these are floor rates.';

  return {
    available: true,
    currency: 'INR',
    follower_count: followers,
    engagement_rate: er,
    tier,
    tier_label: tierLabel,
    has_custom: hasCustom,
    items,
    packages,
    note: stored.note ?? null,
    headline,
    basis,
  };
}

// Validate + normalise a rate-card patch before it's merged into creator_prefs.
export interface RateCardPatch { rates?: unknown; enabled?: unknown; note?: unknown }
export function sanitizeRateCard(input: RateCardPatch): RateCardStored {
  const out: RateCardStored = {};
  const rates: Partial<Record<RateItemKey, number | null>> = {};
  const enabled: Partial<Record<RateItemKey, boolean>> = {};

  if (input.rates && typeof input.rates === 'object') {
    for (const key of ORDER) {
      const v = (input.rates as Record<string, unknown>)[key];
      if (v === null || v === '' || v === undefined) { rates[key] = null; continue; }
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) rates[key] = Math.min(100_000_000, Math.round(n));
    }
  }
  if (input.enabled && typeof input.enabled === 'object') {
    for (const key of ORDER) {
      const v = (input.enabled as Record<string, unknown>)[key];
      if (typeof v === 'boolean') enabled[key] = v;
    }
  }
  if (Object.keys(rates).length) out.rates = rates;
  if (Object.keys(enabled).length) out.enabled = enabled;
  if (typeof input.note === 'string') {
    const n = input.note.trim().slice(0, 280);
    out.note = n.length ? n : null;
  }
  return out;
}
