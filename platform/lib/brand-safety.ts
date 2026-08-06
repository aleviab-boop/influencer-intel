// ============================================================
// Brand-safety / sponsorship-readiness — the due-diligence pass a brand runs
// before signing a creator, turned into something the creator can see FIRST.
// It reads the caption corpus for the things that make a brand hesitate:
// disclosure hygiene on paid posts (#ad / paid-partnership), how commercialised
// the feed already is (ad fatigue + conflict risk), and unsafe language.
// The output is a media-kit-ready "brand-safe" score plus a short checklist of
// exactly what to tidy up.
//
// Pure and deterministic — plain keyword rules over caption text the route
// already fetched. No ML, no LLM. Directional and conservative: it flags
// patterns to review, it doesn't pass moral judgement.
// ============================================================

export interface SafetyPost {
  caption: string | null;
}

export interface SafetyCheck {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface BrandSafety {
  available: boolean;
  sample_size: number;
  score: number;                 // 0–100
  grade: 'brand-safe' | 'mostly-safe' | 'needs-review';
  commercial_posts: number;      // posts that read as promotional
  disclosed_posts: number;       // of those, how many carried a disclosure tag
  checks: SafetyCheck[];
  headline: string | null;
  tip: string | null;
}

const MIN_SAMPLE = 5;

// A post reads as commercial if it pushes a product/offer.
const COMMERCIAL_MARKERS = [
  'use code', 'discount code', 'promo code', 'coupon', '% off', 'shop now', 'buy now',
  'link in bio to shop', 'available now', 'get yours', 'order now', 'swipe up to shop',
  'gifted', 'in collaboration', 'collab with', 'brand partner', 'ambassador',
  'sponsored by', 'thanks to', 'partnered with', 'my code', 'shop my',
];
// Proper FTC/ASCI-style disclosure signals.
const DISCLOSURE_MARKERS = [
  '#ad', '#sponsored', '#paidpartnership', '#paidpartner', 'paid partnership',
  'paid promotion', '#collab', '#gifted', '#ambassador', 'in partnership with',
];
// Clearly unsafe language (kept deliberately small + unambiguous).
const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'cunt', 'slut', 'whore'];
// Topics many brands treat as sensitive for placement (flag to review, not condemn).
const SENSITIVE = ['politics', 'political', 'election', 'religion', 'religious', 'gambling', 'casino', 'betting', 'alcohol', 'vape', 'tobacco', 'cigarette'];

function countMatching(captions: string[], markers: string[]): number {
  return captions.filter((c) => markers.some((m) => c.includes(m))).length;
}
function hasWord(c: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(c));
}

export function analyzeBrandSafety(posts: SafetyPost[]): BrandSafety {
  const captions = posts
    .map((p) => (p.caption ?? '').toLowerCase().trim())
    .filter((c) => c.length > 0);

  const empty: BrandSafety = {
    available: false, sample_size: captions.length, score: 0, grade: 'needs-review',
    commercial_posts: 0, disclosed_posts: 0, checks: [], headline: null, tip: null,
  };
  if (captions.length < MIN_SAMPLE) return empty;

  const n = captions.length;

  // ---- Commercial vs disclosure -----------------------------------------
  const commercialCaptions = captions.filter((c) => COMMERCIAL_MARKERS.some((m) => c.includes(m)));
  const commercial = commercialCaptions.length;
  const disclosed = commercialCaptions.filter((c) => DISCLOSURE_MARKERS.some((m) => c.includes(m))).length;
  const undisclosed = commercial - disclosed;
  const commercialShare = Math.round((commercial / n) * 100);

  // ---- Language / sensitive scans ---------------------------------------
  const profaneCount = captions.filter((c) => hasWord(c, PROFANITY)).length;
  const sensitiveCount = countMatching(captions, SENSITIVE);

  const checks: SafetyCheck[] = [];
  let score = 100;

  // Check 1 — disclosure hygiene on paid posts.
  if (commercial === 0) {
    checks.push({ key: 'disclosure', label: 'Ad disclosure', status: 'pass',
      detail: 'No overtly promotional posts detected — nothing requiring a disclosure tag.' });
  } else {
    const discRate = Math.round((disclosed / commercial) * 100);
    if (undisclosed === 0) {
      checks.push({ key: 'disclosure', label: 'Ad disclosure', status: 'pass',
        detail: `All ${commercial} promotional post${commercial === 1 ? '' : 's'} carry a disclosure tag — clean FTC/ASCI hygiene.` });
    } else if (discRate >= 50) {
      score -= 12;
      checks.push({ key: 'disclosure', label: 'Ad disclosure', status: 'warn',
        detail: `${undisclosed} of ${commercial} promotional posts have no #ad/#sponsored tag — add disclosures to stay compliant.` });
    } else {
      score -= 25;
      checks.push({ key: 'disclosure', label: 'Ad disclosure', status: 'fail',
        detail: `${undisclosed} of ${commercial} promotional posts appear undisclosed — a red flag for brands and regulators.` });
    }
  }

  // Check 2 — commercial balance (ad fatigue / conflict risk).
  if (commercialShare <= 30) {
    checks.push({ key: 'balance', label: 'Promo balance', status: 'pass',
      detail: `${commercialShare}% of posts are promotional — a healthy, non-salesy feed brands like to sit in.` });
  } else if (commercialShare <= 50) {
    score -= 10;
    checks.push({ key: 'balance', label: 'Promo balance', status: 'warn',
      detail: `${commercialShare}% of posts are promotional — leaning ad-heavy; mix in more organic content.` });
  } else {
    score -= 20;
    checks.push({ key: 'balance', label: 'Promo balance', status: 'fail',
      detail: `${commercialShare}% of posts are promotional — an over-commercialised feed dilutes each partner's impact.` });
  }

  // Check 3 — language safety.
  if (profaneCount === 0) {
    checks.push({ key: 'language', label: 'Safe language', status: 'pass',
      detail: 'No flagged profanity in your captions — safe for most brand placements.' });
  } else if (profaneCount <= 2) {
    score -= 12;
    checks.push({ key: 'language', label: 'Safe language', status: 'warn',
      detail: `${profaneCount} post${profaneCount === 1 ? '' : 's'} contain strong language — fine for some brands, a dealbreaker for family-friendly ones.` });
  } else {
    score -= 22;
    checks.push({ key: 'language', label: 'Safe language', status: 'fail',
      detail: `${profaneCount} posts contain strong language — narrows the brands comfortable partnering with you.` });
  }

  // Check 4 — sensitive-topic exposure (informational; light penalty).
  if (sensitiveCount === 0) {
    checks.push({ key: 'sensitive', label: 'Sensitive topics', status: 'pass',
      detail: 'No politics, gambling, alcohol or similar sensitive themes detected.' });
  } else {
    score -= 6;
    checks.push({ key: 'sensitive', label: 'Sensitive topics', status: 'warn',
      detail: `${sensitiveCount} post${sensitiveCount === 1 ? '' : 's'} touch sensitive themes (politics, alcohol, gambling, etc.) — some brand categories avoid adjacency here.` });
  }

  score = Math.max(0, Math.min(100, score));
  const grade: BrandSafety['grade'] = score >= 85 ? 'brand-safe' : score >= 65 ? 'mostly-safe' : 'needs-review';

  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');

  let headline: string;
  if (grade === 'brand-safe') {
    headline = `Your feed reads as brand-safe — clean disclosures and language that suits most partners.`;
  } else if (grade === 'mostly-safe') {
    headline = `Mostly brand-safe with a couple of things to tidy before a big partnership.`;
  } else {
    headline = `A few brand-safety flags worth clearing — brands run this exact check before signing.`;
  }

  const first = fails[0] ?? warns[0] ?? null;
  const tip = first
    ? (first.key === 'disclosure' ? 'Add #ad or “paid partnership” to every gifted or paid post — it is the single biggest trust signal for brands.'
      : first.key === 'balance' ? 'Space out sponsored posts with organic content so each partner gets a cleaner stage.'
        : first.key === 'language' ? 'Keep captions clean on posts you might pitch to brands — you can always be edgier elsewhere.'
          : 'Note any sensitive-topic posts in your media kit so brands know the context up front.')
    : 'Keep it up — a clean, well-disclosed feed is a genuine selling point in your pitch.';

  return {
    available: true,
    sample_size: n,
    score,
    grade,
    commercial_posts: commercial,
    disclosed_posts: disclosed,
    checks,
    headline,
    tip,
  };
}
