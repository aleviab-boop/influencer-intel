// ============================================================
// Creator scorecard — the one-line verdict that sits ATOP everything else.
// The dashboard scores each dimension in isolation (engagement vs peers,
// audience quality, posting consistency, brand safety, growth); this rolls them
// into a single 0–100 grade and, crucially, names the 2–3 standout strengths a
// creator should lead their pitch with — plus the weakest link to shore up.
// It's the summary a media kit opens with.
//
// TRANSPARENT: a plain weighted blend of sub-scores already computed elsewhere,
// each normalised to 0–100. Missing dimensions are dropped and the weights
// renormalise, so the grade always reflects only what we could actually measure.
// No ML, no LLM. Directional — a snapshot of the signals we have.
// ============================================================

// --- Minimal structural inputs (decoupled from the source analysis types) ---
interface BenchmarkLike { available: boolean; percentile: number | null; verdict: 'top' | 'above' | 'typical' | 'below' | null }
interface ScoredLike { available: boolean; score: number | null }
interface GrowthLike { available: boolean; trend: 'growing' | 'flat' | 'declining' | null; weekly_pct: number | null }

export interface ScorecardInput {
  benchmark?: BenchmarkLike | null;
  audience_quality?: ScoredLike | null;
  posting_consistency?: ScoredLike | null;
  brand_safety?: ScoredLike | null;
  growth_projection?: GrowthLike | null;
}

export interface ScorePillar {
  key: string;
  label: string;
  score: number;                 // 0–100
  weight: number;                // relative weight in the blend
  blurb: string;                 // one-line, pitch-ready framing
}

export interface CreatorScorecard {
  available: boolean;
  score: number;                 // 0–100 overall
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  tier_label: string;            // "Standout" … "Developing"
  pillars: ScorePillar[];        // measured dimensions, strongest first
  strengths: string[];           // pitch-ready lead lines (top pillars)
  watch_out: string | null;      // weakest measured dimension
  headline: string | null;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

// Map a growth pace to a 0–100 score (flat ≈ 50, strong growth ≈ 90+).
function growthScore(g: GrowthLike): number {
  if (g.weekly_pct == null) return g.trend === 'growing' ? 65 : g.trend === 'declining' ? 35 : 50;
  return clamp(50 + g.weekly_pct * 9);
}

function band(score: number, hi: string, mid: string, lo: string): string {
  return score >= 70 ? hi : score >= 45 ? mid : lo;
}

export function buildScorecard(input: ScorecardInput): CreatorScorecard {
  const pillars: (ScorePillar & { good: string; weak: string })[] = [];

  // 1) Engagement vs peers (weightiest — it's what brands price on).
  if (input.benchmark?.available && input.benchmark.percentile != null) {
    const p = input.benchmark.percentile;
    pillars.push({
      key: 'engagement', label: 'Engagement vs peers', score: clamp(p), weight: 1.3,
      blurb: band(p, `Top ${Math.max(1, 100 - Math.round(p))}% engagement in your peer set`,
        'Solid, peer-competitive engagement', 'Engagement trails your peer set'),
      good: `engagement in the top ${Math.max(1, 100 - Math.round(p))}% of your peer set`,
      weak: 'lift engagement toward your peer median',
    });
  }

  // 2) Audience quality / authenticity.
  if (input.audience_quality?.available && input.audience_quality.score != null) {
    const s = input.audience_quality.score;
    pillars.push({
      key: 'audience', label: 'Audience quality', score: clamp(s), weight: 1.2,
      blurb: band(s, 'A real, healthy, engaged audience', 'A broadly healthy audience', 'Audience-quality signals to shore up'),
      good: 'a real, healthy audience brands can trust',
      weak: 'tighten audience-quality signals',
    });
  }

  // 3) Posting consistency.
  if (input.posting_consistency?.available && input.posting_consistency.score != null) {
    const s = input.posting_consistency.score;
    pillars.push({
      key: 'consistency', label: 'Posting consistency', score: clamp(s), weight: 1.0,
      blurb: band(s, 'A dependable, steady posting rhythm', 'A fairly regular cadence', 'An uneven posting rhythm'),
      good: 'a dependable posting rhythm',
      weak: 'steady your posting cadence',
    });
  }

  // 4) Brand safety / sponsorship readiness.
  if (input.brand_safety?.available && input.brand_safety.score != null) {
    const s = input.brand_safety.score;
    pillars.push({
      key: 'brand_safety', label: 'Brand safety', score: clamp(s), weight: 1.0,
      blurb: band(s, 'A clean, brand-safe, well-disclosed feed', 'A mostly brand-safe feed', 'Brand-safety flags to clear'),
      good: 'a clean, brand-safe feed',
      weak: 'clear the brand-safety flags on your feed',
    });
  }

  // 5) Growth trajectory.
  if (input.growth_projection?.available) {
    const s = growthScore(input.growth_projection);
    pillars.push({
      key: 'growth', label: 'Growth trajectory', score: s, weight: 0.9,
      blurb: band(s, 'Growing steadily — momentum on your side', 'Holding steady', 'Growth has stalled'),
      good: 'steady follower growth',
      weak: 'restart follower growth',
    });
  }

  const empty: CreatorScorecard = {
    available: false, score: 0, grade: 'C', tier_label: 'Developing',
    pillars: [], strengths: [], watch_out: null, headline: null,
  };
  // Need at least two measured dimensions for a meaningful composite.
  if (pillars.length < 2) return empty;

  // Weighted blend over the dimensions we actually have.
  const totalW = pillars.reduce((s, p) => s + p.weight, 0);
  const overall = clamp(pillars.reduce((s, p) => s + p.score * p.weight, 0) / totalW);

  const grade: CreatorScorecard['grade'] =
    overall >= 85 ? 'A+' : overall >= 72 ? 'A' : overall >= 58 ? 'B' : overall >= 42 ? 'C' : 'D';
  const tier_label =
    overall >= 85 ? 'Standout' : overall >= 72 ? 'Strong' : overall >= 58 ? 'Solid' : overall >= 42 ? 'Developing' : 'Early';

  const ranked = [...pillars].sort((a, b) => b.score - a.score);
  const strengths = ranked.filter((p) => p.score >= 60).slice(0, 3).map((p) => p.good);
  // Fall back to the single best dimension if nothing clears the bar.
  if (!strengths.length && ranked[0]) strengths.push(ranked[0].good);

  const weakest = ranked[ranked.length - 1]!;
  const watch_out = weakest.score < 55 ? `To level up: ${weakest.weak}.` : null;

  const strengthPhrase = strengths.length
    ? strengths.slice(0, 2).join(' and ')
    : 'a promising all-round profile';
  const headline = `${tier_label} creator (${grade}) — you bring ${strengthPhrase}.`;

  return {
    available: true,
    score: overall,
    grade,
    tier_label,
    // Public shape drops the internal good/weak strings.
    pillars: ranked.map(({ good: _g, weak: _w, ...p }) => p),
    strengths,
    watch_out,
    headline,
  };
}
