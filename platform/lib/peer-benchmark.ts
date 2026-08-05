// ============================================================
// Peer benchmarking — "how do I compare to creators like me?"
//
// A single ER number means little without context. This module ranks a
// creator's engagement against a cohort of DB creators in the SAME follower
// tier (and, when the sample is big enough, the same niche). It returns a
// percentile, the cohort median, and a plain-English tier label so the
// dashboard can say "you're in the top 20% of mid-tier fashion creators".
//
// The cohort ER values come from a DB query in the analytics route; the math
// here is pure and testable.
// ============================================================

export interface PeerBenchmark {
  available: boolean;
  cohort_size: number;
  cohort_label: string;          // e.g. "micro creators" or "micro fashion creators"
  scope: 'niche' | 'tier';       // which cohort we actually compared against
  your_er: number | null;        // fraction (0.03 = 3%)
  cohort_median_er: number | null;
  cohort_p25_er: number | null;
  cohort_p75_er: number | null;
  percentile: number | null;     // 0..100 — % of the cohort you beat
  verdict: 'top' | 'above' | 'typical' | 'below' | null;
}

export interface BenchmarkCohorts {
  your_er: number | null;
  tier_label: string;
  niche_label: string | null;
  tier_ers: number[];            // cohort ERs (fractions), tier only
  niche_ers: number[];           // cohort ERs (fractions), tier + niche
}

// Follower tiers — mirrors the rate-card tiers so labels stay consistent.
export function tierLabel(followers: number): string {
  if (followers < 10_000) return 'nano';
  if (followers < 50_000) return 'micro';
  if (followers < 500_000) return 'mid-tier';
  if (followers < 1_000_000) return 'macro';
  return 'mega';
}

/** Follower window for "creators like me" — within ~3× either way, same as /similar. */
export function tierWindow(followers: number): { lo: number; hi: number } {
  return { lo: Math.floor(followers / 3), hi: Math.ceil(followers * 3) };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next != null ? sorted[base]! + rest * (next - sorted[base]!) : sorted[base]!;
}

// Minimum cohort sizes: prefer the niche cohort only if it's big enough to
// mean something; otherwise fall back to the broader tier cohort.
const MIN_NICHE = 12;
const MIN_TIER = 8;

export function computeBenchmark(c: BenchmarkCohorts): PeerBenchmark {
  const empty: PeerBenchmark = {
    available: false, cohort_size: 0, cohort_label: c.tier_label + ' creators',
    scope: 'tier', your_er: c.your_er, cohort_median_er: null,
    cohort_p25_er: null, cohort_p75_er: null, percentile: null, verdict: null,
  };
  if (c.your_er == null || c.your_er <= 0) return empty;

  // Choose the cohort: niche if it clears MIN_NICHE, else tier if it clears MIN_TIER.
  const useNiche = c.niche_label != null && c.niche_ers.length >= MIN_NICHE;
  const ers = useNiche ? c.niche_ers : c.tier_ers;
  const scope: PeerBenchmark['scope'] = useNiche ? 'niche' : 'tier';
  const label = useNiche ? `${c.tier_label} ${c.niche_label} creators` : `${c.tier_label} creators`;

  if (ers.length < MIN_TIER) return { ...empty, cohort_label: label };

  const sorted = [...ers].filter((v) => v > 0).sort((a, b) => a - b);
  const beat = sorted.filter((v) => v < c.your_er!).length;
  const percentile = Math.round((beat / sorted.length) * 100);

  const median = quantile(sorted, 0.5);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);

  const verdict: PeerBenchmark['verdict'] =
    percentile >= 80 ? 'top' : percentile >= 60 ? 'above' : percentile >= 35 ? 'typical' : 'below';

  return {
    available: true,
    cohort_size: sorted.length,
    cohort_label: label,
    scope,
    your_er: c.your_er,
    cohort_median_er: median,
    cohort_p25_er: p25,
    cohort_p75_er: p75,
    percentile,
    verdict,
  };
}
