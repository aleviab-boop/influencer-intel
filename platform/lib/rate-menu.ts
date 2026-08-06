// ============================================================
// Deliverable rate menu — the rate card gives per-format prices; a brand deal is
// almost never a single format. This expands those base prices into the PACKAGES
// creators actually sell (a Reel, a Story set, a Reel+Stories bundle, a full
// campaign package, a monthly retainer) plus the add-ons that quietly move a
// quote the most (usage rights, exclusivity, whitelisting, rush). Each line has a
// justified range and a one-line rationale — the copy-ready price sheet that
// drops straight into a media kit.
//
// Pure and deterministic: derived arithmetically from the rate-card items the
// route already computed (bundles carry a transparent multi-deliverable
// discount). No ML, no LLM. Ranges are starting points, labelled as such.
// ============================================================

// Minimal structural input (decoupled from media-kit's RateCard type).
interface RateItemLike { label: string; low: number; high: number }
interface RateCardLike { currency: 'INR'; tier_label: string; items: RateItemLike[] }

export interface Deliverable {
  key: string;
  label: string;
  low: number;
  high: number;
  is_pct: boolean;       // true → low/high are % upcharges, not absolute ₹
  rationale: string;
  popular?: boolean;
}

export interface RateMenu {
  available: boolean;
  currency: 'INR';
  tier_label: string;
  packages: Deliverable[];
  addons: Deliverable[];
  headline: string | null;
  note: string;
}

function roundNice(v: number): number {
  if (v <= 0) return 0;
  if (v < 2_000) return Math.round(v / 100) * 100;
  if (v < 20_000) return Math.round(v / 500) * 500;
  return Math.round(v / 1_000) * 1_000;
}

const mid = (it: RateItemLike | undefined): number => (it ? (it.low + it.high) / 2 : 0);

export function buildRateMenu(card: RateCardLike | null | undefined): RateMenu {
  const empty: RateMenu = {
    available: false, currency: 'INR', tier_label: '', packages: [], addons: [],
    headline: null, note: '',
  };
  if (!card || !card.items?.length) return empty;

  const byLabel = new Map(card.items.map((i) => [i.label.toLowerCase(), i]));
  const reel = byLabel.get('reel');
  const carousel = byLabel.get('carousel');
  const staticPost = byLabel.get('static post');
  const storyFrame = byLabel.get('story (per frame)');

  const reelMid = mid(reel);
  const carouselMid = mid(carousel) || mid(staticPost);
  const storyMid = mid(storyFrame);
  if (reelMid <= 0 && carouselMid <= 0) return empty;

  const packages: Deliverable[] = [];
  const range = (m: number): { low: number; high: number } => ({ low: roundNice(m * 0.85), high: roundNice(m * 1.2) });

  if (reel) {
    const r = range(reelMid);
    packages.push({ key: 'reel', label: 'Sponsored Reel', low: r.low, high: r.high, is_pct: false,
      rationale: 'Your highest-reach format — the anchor of most brand deals.', popular: true });
  }
  if (carousel || staticPost) {
    const r = range(carouselMid);
    packages.push({ key: 'feed', label: 'Feed post (carousel / static)', low: r.low, high: r.high, is_pct: false,
      rationale: 'A permanent in-feed placement with lasting discoverability.' });
  }
  if (storyMid > 0) {
    const r = range(storyMid * 3);
    packages.push({ key: 'stories', label: 'Story set (3 frames)', low: r.low, high: r.high, is_pct: false,
      rationale: 'A 3-frame story sequence with a swipe-up / link sticker.' });
  }
  if (reelMid > 0 && storyMid > 0) {
    const bundle = (reelMid + storyMid * 3) * 0.9;   // ~10% bundle discount
    const r = range(bundle);
    packages.push({ key: 'reel_stories', label: 'Reel + 3 Stories bundle', low: r.low, high: r.high, is_pct: false,
      rationale: 'Feed + story amplification together — the most-booked combo (≈10% vs à la carte).', popular: true });
  }
  if (reelMid > 0 && carouselMid > 0 && storyMid > 0) {
    const full = (reelMid + carouselMid + storyMid * 3) * 0.85;   // ~15% package discount
    const r = range(full);
    packages.push({ key: 'campaign', label: 'Full campaign (Reel + post + Stories)', low: r.low, high: r.high, is_pct: false,
      rationale: 'A complete launch push across every placement (≈15% vs à la carte).' });
  }
  if (reelMid > 0) {
    const monthly = (reelMid * 2 + storyMid * 4) * 0.8;   // 2 reels + 4 stories/mo, ~20% off
    const r = range(monthly);
    packages.push({ key: 'retainer', label: 'Monthly retainer (2 Reels + 4 Stories)', low: r.low, high: r.high, is_pct: false,
      rationale: 'Ongoing ambassador cadence billed monthly — best value, locks in the relationship.' });
  }

  // Add-ons expressed as % upcharges on the deliverable they modify.
  const addons: Deliverable[] = [
    { key: 'usage', label: 'Usage / paid-media rights', low: 40, high: 60, is_pct: true,
      rationale: 'Lets the brand run your content as their own ads — price per 3–6 months of usage.' },
    { key: 'exclusivity', label: 'Category exclusivity', low: 25, high: 50, is_pct: true,
      rationale: "You agree not to promote competitors for a set window — you're turning down other income." },
    { key: 'whitelisting', label: 'Whitelisting / Spark Ads', low: 30, high: 50, is_pct: true,
      rationale: 'Brand runs ads through your handle — more reach and data on their side.' },
    { key: 'rush', label: 'Rush delivery (<48h)', low: 15, high: 25, is_pct: true,
      rationale: 'Fast-turnaround premium when a brand needs it live quickly.' },
  ];

  const headline = `Your ${card.tier_label.toLowerCase()} rate menu — packages and add-ons, ready for your media kit.`;

  return {
    available: true,
    currency: 'INR',
    tier_label: card.tier_label,
    packages,
    addons,
    headline,
    note: 'Suggested starting ranges from your reach and engagement. Add-ons are % upcharges on the base deliverable. Final pricing varies by niche, exclusivity and deliverables.',
  };
}
