// ============================================================
// Engagement reliability — the average ER tells a brand what you do on a good
// day; it says nothing about whether you deliver that CONSISTENTLY. Brands pay a
// premium for predictability: a creator who reliably clears 4% is worth more
// than one who averages 5% by swinging between 1% and 12%. This measures the
// spread of ER across recent posts (coefficient of variation), grades how steady
// it is, and — most usefully — surfaces the FLOOR: the engagement rate even your
// quieter posts clear. That floor is the number you can quietly promise a brand.
//
// Pure and deterministic: plain dispersion stats (mean, median, quartiles,
// coefficient of variation) over the per-post ER the route already fetched. No
// ML, no LLM. Falls silent below a usable sample. Directional on small samples.
// ============================================================

export interface ReliabilityPost {
  er: number | null;
}

export interface EngagementReliability {
  available: boolean;
  sample_size: number;
  avg_er: number | null;
  median_er: number | null;
  floor_er: number | null;        // 25th percentile — "you reliably clear this"
  ceiling_er: number | null;      // 75th percentile — "a strong post lands here"
  cv_pct: number | null;          // coefficient of variation, %
  within_band_pct: number | null; // % of posts within ±35% of the median
  score: number;                  // 0–100 reliability
  grade: 'rock-solid' | 'steady' | 'swingy' | 'volatile';
  headline: string | null;
  tip: string | null;
}

const MIN_SAMPLE = 6;
const BAND = 0.35;   // ±35% of median counts as "on-form"

const mean = (n: number[]): number => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : 0);

// Linear-interpolated percentile over a sorted array (q in 0..1).
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function analyzeEngagementReliability(posts: ReliabilityPost[]): EngagementReliability {
  const ers = posts
    .map((p) => Number(p.er))
    .filter((e) => Number.isFinite(e) && e > 0);

  const empty: EngagementReliability = {
    available: false, sample_size: ers.length, avg_er: null, median_er: null,
    floor_er: null, ceiling_er: null, cv_pct: null, within_band_pct: null,
    score: 0, grade: 'volatile', headline: null, tip: null,
  };
  if (ers.length < MIN_SAMPLE) return empty;

  const avg = mean(ers);
  if (avg <= 0) return empty;

  const sorted = [...ers].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5)!;
  const floor = quantile(sorted, 0.25)!;
  const ceiling = quantile(sorted, 0.75)!;

  // Sample standard deviation → coefficient of variation.
  const variance = ers.reduce((s, e) => s + (e - avg) ** 2, 0) / (ers.length - 1);
  const sd = Math.sqrt(variance);
  const cv = sd / avg;               // dimensionless
  const cvPct = Math.round(cv * 100);

  const withinBand = ers.filter((e) => Math.abs(e - median) <= median * BAND).length;
  const withinBandPct = Math.round((withinBand / ers.length) * 100);

  // Lower dispersion → higher reliability. Anchored so cv≈0 → 100, cv≈1.15 → ~0.
  const score = Math.max(0, Math.min(100, Math.round(100 - cvPct * 0.85)));
  const grade: EngagementReliability['grade'] =
    cvPct <= 30 ? 'rock-solid' : cvPct <= 55 ? 'steady' : cvPct <= 85 ? 'swingy' : 'volatile';

  const floorStr = (floor * 100).toFixed(1) + '%';
  const GRADE_COPY: Record<EngagementReliability['grade'], string> = {
    'rock-solid': `Your engagement is rock-solid — it barely swings post to post, so a brief you accept is a result you'll deliver.`,
    steady: `Your engagement is steady — most posts land in a tight band, which is exactly what brands want to see.`,
    swingy: `Your engagement swings a fair bit post to post — a mix of hits and quiet ones.`,
    volatile: `Your engagement is volatile — big spikes and quiet posts, so your average oversells a typical post.`,
  };
  const headline = GRADE_COPY[grade];

  const tip = (grade === 'rock-solid' || grade === 'steady')
    ? `Lead your pitch with the floor, not the average: “even my quieter posts clear ${floorStr} engagement.” A floor a brand can count on is worth more than a headline number.`
    : `Tighten the swing before you lean on your average. Look at what your quieter posts had in common (format, topic, length) and cut it — a reliable ${floorStr} floor pitches better than an occasional spike.`;

  return {
    available: true,
    sample_size: ers.length,
    avg_er: avg,
    median_er: median,
    floor_er: floor,
    ceiling_er: ceiling,
    cv_pct: cvPct,
    within_band_pct: withinBandPct,
    score,
    grade,
    headline,
    tip,
  };
}
