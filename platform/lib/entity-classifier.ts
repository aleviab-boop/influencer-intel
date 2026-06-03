// ============================================================
// Heuristic shop / brand-account / creator classifier.
//
// Signals (non-exhaustive; combine with weights):
//   - bio language (order / WhatsApp / COD / catalogue / price)
//   - handle pattern (_fashion, _store, _shop, _outlet, _wholesale)
//   - vision content_themes (storefront / product display / shop)
//   - vision vibe_tags (business / commercial / wholesale)
//   - vision niche (online shop / retailer / boutique)
//   - account_type (Business with retail-ish category)
//
// Output: { type: 'creator' | 'shop' | 'brand_account', score: 0-1, reasons: string[] }
// type=shop  → don't surface to brands looking for influencers
// type=brand_account → official brand (Nike India, Sephora India) — also drop
// type=creator → real human creator we can shortlist
// ============================================================

import type { Creator } from '@influencer-intel/shared/types';

const SHOP_BIO_PATTERNS: RegExp[] = [
  /\bwhatsapp\b.{0,40}\b(to\s+order|order|inquiry|inquir)/i,
  /\bdm\b.{0,15}\b(to\s+order|order|price)/i,
  /\b(cod|cash on delivery|cash-on-delivery)\b/i,
  /\b(shop|store|boutique|wholesale|wholesaler|wholesalers|emporium|mart|outlet)\b/i,
  /\bcataloque|catalogue|catalog\b/i,
  /\b(price|prices|pricing)\s*(:|@|starts|from)\b/i,
  /₹\s*\d|\bRs\.?\s*\d|\bMRP\b|\bINR\s*\d/i,
  /\b(all india shipping|shipping pan india|free delivery|cod available)\b/i,
  /\b(order on|to place an order|to order)\b/i,
  /\b(boutique|brand|brands|official\s+store)\b/i,
];

const SHOP_HANDLE_PATTERNS: RegExp[] = [
  // strict tokens
  /[_.](shop|store|outlet|mart|wholesale|trading|brand|brands|emporium|company|llp|pvt)/i,
  /(_| |\.)?(by|inc|ltd|llp|pvt|co)\.?$/i,
  /^(shop|store|boutique|brand)[_.]/i,
  // soft signals — fashion/clothing/saree/kurti accounts with numeric/business suffix
  /(_|^)(fashions?|outlett?|outletts?|sarees?|sari|kurtis?|kurta|lehenga|wear|clothing|apparel|jewell?ery|cosmetics?)([0-9_]|s|$)/i,
  /[_.](house|palace|gallery|hub|world|bazaar|emporium|collection)\b/i,
  /(_|^)official([0-9_]|$)/i,            // _official, official2, etc
];

const SHOP_VISION_THEMES = new Set([
  'storefront',
  'product display',
  'product displays',
  'indoor displays',
  'shop display',
  'shop interior',
  'store interior',
  'product photos',
  'product showcase',
  'clothing display',
  'merchandise',
  'product photography',
]);

const SHOP_VIBE_TAGS = new Set(['business', 'commercial', 'wholesale', 'retail', 'corporate']);

const BRAND_ACCOUNT_INDICATORS = [
  'official store',
  'official brand',
  'authorized retailer',
  'authorised retailer',
  'distributor',
  'flagship',
];

export interface EntityClassification {
  type: 'creator' | 'shop' | 'brand_account' | 'unknown';
  score: number; // 0-1, how confident we are it's the assigned non-creator type
  reasons: string[];
}

export function classifyEntity(creator: Creator): EntityClassification {
  const reasons: string[] = [];
  let shopScore = 0;
  let brandScore = 0;

  // FIRST: trust vision's direct classification when available + confident.
  // Vision (gpt-4o looking at the actual screenshot) is way better than
  // bio-pattern heuristics for accounts whose bios don't shout "shop".
  const vision = (creator.raw_metadata as { vision?: Record<string, unknown> } | undefined)?.vision;
  const visionEntity = (vision?.entity_type as string | undefined)?.toLowerCase();
  const visionConfidence = (vision?.entity_type_confidence as string | undefined)?.toLowerCase();

  if (visionEntity === 'shop' && (visionConfidence === 'high' || visionConfidence === 'medium')) {
    return {
      type: 'shop',
      score: visionConfidence === 'high' ? 0.95 : 0.7,
      reasons: [`vision flagged as shop (${visionConfidence})`],
    };
  }
  if (visionEntity === 'brand_account' && visionConfidence !== 'low') {
    return {
      type: 'brand_account',
      score: 0.9,
      reasons: ['vision flagged as brand_account'],
    };
  }
  if (visionEntity === 'agency' || visionEntity === 'publication') {
    return {
      type: 'brand_account',
      score: 0.85,
      reasons: [`vision flagged as ${visionEntity}`],
    };
  }
  // If vision says "creator" with high confidence, short-circuit positive.
  if (visionEntity === 'creator' && visionConfidence === 'high') {
    return { type: 'creator', score: 0.95, reasons: ['vision flagged as creator (high)'] };
  }

  const bio = (creator.bio ?? '').toLowerCase();
  const handle = (creator.handle ?? '').toLowerCase();
  const displayName = (creator.display_name ?? '').toLowerCase();

  // --- bio pattern matching ---
  for (const re of SHOP_BIO_PATTERNS) {
    if (re.test(bio)) {
      shopScore += 0.25;
      reasons.push(`bio matches ${re.source.slice(0, 30)}`);
      break; // one bio match is enough — don't double-count
    }
  }

  // --- handle pattern matching ---
  for (const re of SHOP_HANDLE_PATTERNS) {
    if (re.test(handle)) {
      shopScore += 0.20;
      reasons.push(`handle pattern ${re.source.slice(0, 30)}`);
      break;
    }
  }

  // --- display name signals ---
  if (/\b(shop|store|boutique|wholesale|llp|pvt|brand|inc|ltd)\b/i.test(displayName)) {
    shopScore += 0.20;
    reasons.push('display_name contains shop word');
  }

  // --- publication / event / agency / brand-account heuristics ---
  // Bio-language signals that scream "this is an organisation, not a person".
  const PUBLICATION_PATTERNS: RegExp[] = [
    /\bofficial\s+(account|instagram|page|handle)\b/i,
    /\bthe\s+official\b/i,
    /\bfashion\s+week\b/i,
    /\bmagazine\b/i,
    /\bnews\b/i,
    /\bmedia\b/i,
    /\b(coverage|covering)\s+(of|the)\b/i,
    /\bdesigners?:\s*(apply|register|submit)/i,
    /\bawards?\s+(202[0-9]|night|2025|2026)\b/i,
    /\bevent(?:s)?\s+management\b/i,
    /\b(conference|summit|expo|festival)\b/i,
    /\bhq\b/i,
  ];
  for (const re of PUBLICATION_PATTERNS) {
    if (re.test(bio) || re.test(displayName)) {
      brandScore += 0.6;
      reasons.push(`publication/org pattern: ${re.source.slice(0, 30)}`);
      break;
    }
  }

  // Handle patterns that scream organisation
  const ORG_HANDLE_PATTERNS: RegExp[] = [
    /\b(week|expo|fest|awards?|magazine|news|media|agency|studios?|productions?|hq)\b/i,
    /^the[._]/i,
    /[._]official$/i,
  ];
  for (const re of ORG_HANDLE_PATTERNS) {
    if (re.test(handle)) {
      brandScore += 0.35;
      reasons.push(`org handle pattern: ${re.source.slice(0, 30)}`);
      break;
    }
  }

  // --- vision signals (vision was already pulled at top of fn) ---
  const contentThemes = (vision?.content_themes ?? []) as unknown[];
  const vibeTags = (vision?.vibe_tags ?? []) as unknown[];
  const niche = String(vision?.niche ?? '').toLowerCase();
  const subNiches = (vision?.sub_niches ?? []) as unknown[];

  const themeHits = contentThemes.filter(
    (t) => typeof t === 'string' && SHOP_VISION_THEMES.has(t.toLowerCase()),
  );
  if (themeHits.length > 0) {
    shopScore += Math.min(0.4, themeHits.length * 0.2);
    reasons.push(`vision themes: ${themeHits.join(', ')}`);
  }
  const vibeHits = vibeTags.filter(
    (t) => typeof t === 'string' && SHOP_VIBE_TAGS.has(t.toLowerCase()),
  );
  if (vibeHits.length > 0) {
    shopScore += 0.15;
    reasons.push(`vibe: ${vibeHits.join(', ')}`);
  }
  if (niche.includes('shop') || niche.includes('retailer') || niche.includes('boutique')) {
    shopScore += 0.25;
    reasons.push(`niche=${niche}`);
  }
  for (const sn of subNiches) {
    if (typeof sn === 'string' && /\b(shop|retailer|boutique|brand|store)\b/i.test(sn)) {
      shopScore += 0.1;
      reasons.push(`sub_niche: ${sn}`);
      break;
    }
  }

  // --- following:follower ratio (shops follow few accounts) ---
  if (
    creator.follower_count != null &&
    creator.following_count != null &&
    creator.follower_count > 5_000 &&
    creator.following_count < 50
  ) {
    shopScore += 0.15;
    reasons.push(`tiny following (${creator.following_count}) vs ${creator.follower_count} followers`);
  }

  // --- official brand-account patterns (Verified + brand language) ---
  if (creator.is_verified) {
    for (const ind of BRAND_ACCOUNT_INDICATORS) {
      if (bio.includes(ind) || displayName.includes(ind)) {
        brandScore += 0.4;
        reasons.push(`brand indicator: ${ind}`);
        break;
      }
    }
  }

  shopScore = Math.min(1, shopScore);
  brandScore = Math.min(1, brandScore);

  if (brandScore >= 0.4) {
    return { type: 'brand_account', score: brandScore, reasons };
  }
  if (shopScore >= 0.45) {
    return { type: 'shop', score: shopScore, reasons };
  }
  if (shopScore >= 0.25) {
    // Ambiguous — could be a creator with shoppy bio. Flag but don't disqualify.
    return { type: 'unknown', score: shopScore, reasons };
  }
  return { type: 'creator', score: 1 - shopScore, reasons };
}
