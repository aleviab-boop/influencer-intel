// ============================================================
// Audience–brand fit — "does YOUR audience match THEIR customer?".
//
// Niche keywords tell you a brand is topically relevant; this goes a layer
// deeper and asks whether the creator's actual audience (age / gender skew,
// and metro concentration) lines up with who that brand category typically
// sells to. It turns the raw IG demographics into a defensible "your audience
// is their buyer" rationale for each matched brand.
//
// TRANSPARENT and rule-based: a small curated map of brand category → typical
// target profile, compared against the creator's real demographic shares. No
// ML, no network. Clearly directional — audiences overlap categories.
// ============================================================

export interface AudienceProfile {
  gender_age: Record<string, number>;         // e.g. { "F.25-34": 1240, "M.18-24": 610 }
  cities?: Record<string, number>;
  countries?: Record<string, number>;
}

export type FitLabel = 'excellent' | 'strong' | 'moderate' | 'broad';

export interface AudienceFit {
  available: boolean;
  score: number;                 // 0..100 alignment
  label: FitLabel;
  rationale: string;             // one-line "your audience is their buyer"
  signals: string[];             // supporting bullets
}

type Gender = 'female' | 'male' | 'any';

interface TargetProfile {
  gender: Gender;
  ageBands: string[];            // canonical IG bands this category skews toward
  metro: boolean;                // does it over-index on metro/urban buyers?
  buyer: string;                 // human noun for the rationale ("beauty buyers")
}

// Canonical IG age bands.
const AGE_BANDS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

// Curated category → typical target. Keys are matched by substring against the
// brand's category string, so "beauty & personal care" still hits "beauty".
const TARGETS: { keys: string[]; profile: TargetProfile }[] = [
  { keys: ['beauty', 'cosmetic', 'makeup', 'skincare'], profile: { gender: 'female', ageBands: ['18-24', '25-34'], metro: true, buyer: 'beauty buyers' } },
  { keys: ['fashion', 'apparel', 'clothing', 'jewel', 'accessor'], profile: { gender: 'female', ageBands: ['18-24', '25-34'], metro: true, buyer: 'fashion shoppers' } },
  { keys: ['fitness', 'gym', 'wellness', 'health', 'nutrition', 'supplement'], profile: { gender: 'any', ageBands: ['18-24', '25-34', '35-44'], metro: false, buyer: 'health-conscious buyers' } },
  { keys: ['tech', 'gadget', 'electronic', 'software', 'app', 'saas'], profile: { gender: 'male', ageBands: ['18-24', '25-34'], metro: true, buyer: 'tech buyers' } },
  { keys: ['gaming', 'game', 'esport'], profile: { gender: 'male', ageBands: ['13-17', '18-24'], metro: false, buyer: 'gamers' } },
  { keys: ['food', 'beverage', 'restaurant', 'snack', 'cafe', 'coffee'], profile: { gender: 'any', ageBands: ['18-24', '25-34', '35-44'], metro: true, buyer: 'foodies' } },
  { keys: ['travel', 'hotel', 'tourism', 'hospitality', 'airline'], profile: { gender: 'any', ageBands: ['25-34', '35-44'], metro: true, buyer: 'travellers' } },
  { keys: ['finance', 'fintech', 'bank', 'invest', 'insurance', 'trading'], profile: { gender: 'male', ageBands: ['25-34', '35-44'], metro: true, buyer: 'investors & earners' } },
  { keys: ['parent', 'baby', 'kids', 'child', 'mother', 'mom'], profile: { gender: 'female', ageBands: ['25-34', '35-44'], metro: false, buyer: 'parents' } },
  { keys: ['luxury', 'premium', 'watch', 'automobile', 'automotive', 'car'], profile: { gender: 'any', ageBands: ['25-34', '35-44', '45-54'], metro: true, buyer: 'premium buyers' } },
  { keys: ['education', 'edtech', 'course', 'learning', 'study'], profile: { gender: 'any', ageBands: ['18-24', '25-34'], metro: false, buyer: 'learners' } },
  { keys: ['home', 'decor', 'furniture', 'kitchen', 'appliance'], profile: { gender: 'female', ageBands: ['25-34', '35-44'], metro: true, buyer: 'home shoppers' } },
  { keys: ['gift', 'lifestyle', 'ecommerce', 'retail', 'consumer'], profile: { gender: 'any', ageBands: ['18-24', '25-34', '35-44'], metro: true, buyer: 'shoppers' } },
];

// Metro/urban markers (India-first, plus generic "metro"/"urban" hints).
const METRO_HINTS = ['mumbai', 'delhi', 'bengaluru', 'bangalore', 'hyderabad', 'chennai',
  'kolkata', 'pune', 'ahmedabad', 'gurgaon', 'gurugram', 'noida', 'metro', 'urban'];

function targetFor(category: string | null | undefined): TargetProfile | null {
  if (!category) return null;
  const c = category.toLowerCase();
  for (const t of TARGETS) if (t.keys.some((k) => c.includes(k))) return t.profile;
  return null;
}

// Parse "F.25-34" / "female.25-34" / "M-18-24" → { gender, band }.
function parseKey(key: string): { gender: Gender; band: string | null } {
  const k = key.toLowerCase();
  const gender: Gender = k.startsWith('f') ? 'female' : k.startsWith('m') ? 'male' : 'any';
  const m = k.match(/\d{1,2}\s*-\s*\d{1,2}|\d{2}\s*\+/);
  const band = m ? m[0].replace(/\s+/g, '') : null;
  return { gender, band };
}

const sum = (o: Record<string, number>): number =>
  Object.values(o).reduce((s, v) => s + (Number(v) || 0), 0);

/**
 * Score how well a creator's audience fits a brand category's typical buyer.
 * Returns available:false when we can't map the category or lack demographics.
 */
export function scoreAudienceFit(category: string | null | undefined, aud: AudienceProfile | null | undefined): AudienceFit {
  const empty: AudienceFit = { available: false, score: 0, label: 'broad', rationale: '', signals: [] };
  const target = targetFor(category);
  if (!target || !aud?.gender_age) return empty;

  const total = sum(aud.gender_age);
  if (total <= 0) return empty;

  // Aggregate audience by gender and by age band.
  let female = 0, male = 0;
  const byAge: Record<string, number> = {};
  for (const [key, raw] of Object.entries(aud.gender_age)) {
    const v = Number(raw) || 0;
    if (v <= 0) continue;
    const { gender, band } = parseKey(key);
    if (gender === 'female') female += v;
    else if (gender === 'male') male += v;
    if (band) byAge[band] = (byAge[band] ?? 0) + v;
  }

  const femaleFrac = female / total;
  const maleFrac = male / total;
  const ageShare = target.ageBands.reduce((s, b) => s + (byAge[b] ?? 0), 0) / total;

  // Gender component (skip when the category is gender-agnostic).
  const genderFrac = target.gender === 'female' ? femaleFrac : target.gender === 'male' ? maleFrac : null;

  // Base score: blend age-band alignment with gender skew.
  let score = genderFrac == null
    ? Math.round(100 * ageShare)
    : Math.round(100 * (0.55 * ageShare + 0.45 * genderFrac));

  // Metro bonus, when the category over-indexes on urban buyers.
  let metroFrac: number | null = null;
  if (target.metro && aud.cities && Object.keys(aud.cities).length) {
    const cTotal = sum(aud.cities);
    if (cTotal > 0) {
      let metro = 0;
      for (const [city, raw] of Object.entries(aud.cities)) {
        const cl = city.toLowerCase();
        if (METRO_HINTS.some((h) => cl.includes(h))) metro += Number(raw) || 0;
      }
      metroFrac = metro / cTotal;
      if (metroFrac >= 0.4) score = Math.min(100, score + 8);
    }
  }

  score = Math.max(0, Math.min(100, score));
  const label: FitLabel = score >= 70 ? 'excellent' : score >= 55 ? 'strong' : score >= 40 ? 'moderate' : 'broad';

  // ---- Human-readable signals -------------------------------------------
  const topBand = Object.entries(byAge).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const pct = (f: number): string => `${Math.round(f * 100)}%`;
  const signals: string[] = [];

  if (topBand) signals.push(`Your audience centres on the ${topBand} band — ${pct((byAge[topBand] ?? 0) / total)} of followers.`);
  if (target.gender !== 'any') {
    const skew = target.gender === 'female' ? femaleFrac : maleFrac;
    signals.push(`${pct(skew)} ${target.gender}, matching this category's typical buyer.`);
  }
  if (metroFrac != null) signals.push(`${pct(metroFrac)} of your audience is in metro cities.`);

  const ageTxt = target.ageBands.length > 1
    ? `${target.ageBands[0]}–${target.ageBands[target.ageBands.length - 1]!.split('-')[0]}`
    : target.ageBands[0];
  const rationale = label === 'broad'
    ? `Your audience only partly overlaps ${target.buyer} (${ageTxt}${target.gender !== 'any' ? `, ${target.gender}-leaning` : ''}) — still worth a pitch on niche relevance.`
    : `${pct(ageShare)} of your audience sits in the ${ageTxt} range this category sells to${target.gender !== 'any' ? `, with a ${target.gender}-leaning skew` : ''} — a ${label} match for ${target.buyer}.`;

  return { available: true, score, label, rationale, signals };
}

export const AGE_BAND_LIST = AGE_BANDS;
