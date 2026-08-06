// ============================================================
// Caption-length sweet spot — the hooks analysis reads how a caption OPENS; this
// asks a blunter question the creator can act on immediately: does length itself
// track with engagement? It buckets every caption by character count (one-liner
// → very long), averages ER within each band, and surfaces the band the
// creator's own audience rewards — plus whether they're already writing there.
// The payoff is a target length range, not a vague "write more / write less".
//
// Pure and deterministic: mean ER per length bucket over the captions + ER the
// route already fetched. No ML, no LLM. Falls silent below a usable sample and
// only trusts buckets with enough posts. Directional — it reports what's
// correlated with this creator's wins, not a universal law.
// ============================================================

export interface LengthPost {
  caption: string | null;
  er: number | null;
}

export interface LengthBucket {
  key: string;
  label: string;
  range: string;            // "80–200 chars"
  lo: number;
  hi: number | null;
  count: number;
  avg_er: number | null;
  lift_pct: number | null;  // vs overall avg
  is_best: boolean;
}

export interface CaptionLength {
  available: boolean;
  sample_size: number;
  overall_avg_er: number | null;
  median_length: number | null;   // the creator's typical caption length
  buckets: LengthBucket[];
  best: LengthBucket | null;
  matches_best: boolean | null;    // is their median already in the best band?
  headline: string | null;
  tip: string | null;
}

interface Band { key: string; label: string; lo: number; hi: number | null }
const BANDS: Band[] = [
  { key: 'oneliner', label: 'One-liner', lo: 0, hi: 80 },
  { key: 'short', label: 'Short', lo: 80, hi: 200 },
  { key: 'medium', label: 'Medium', lo: 200, hi: 500 },
  { key: 'long', label: 'Long', lo: 500, hi: 1000 },
  { key: 'verylong', label: 'Very long', lo: 1000, hi: null },
];

const MIN_SAMPLE = 6;   // total captions needed to say anything
const MIN_CELL = 2;     // posts a band needs before we trust its average

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);
function median(n: number[]): number | null {
  if (!n.length) return null;
  const s = [...n].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

function rangeLabel(b: Band): string {
  if (b.hi == null) return `${b.lo}+ chars`;
  if (b.lo === 0) return `under ${b.hi} chars`;
  return `${b.lo}–${b.hi} chars`;
}

function bandFor(len: number): Band {
  return BANDS.find((b) => len >= b.lo && (b.hi == null || len < b.hi)) ?? BANDS[BANDS.length - 1]!;
}

export function analyzeCaptionLength(posts: LengthPost[]): CaptionLength {
  const points = posts
    .map((p) => ({ len: (p.caption ?? '').trim().length, er: p.er }))
    .filter((p): p is { len: number; er: number } => p.len > 0 && p.er != null && p.er > 0);

  const empty: CaptionLength = {
    available: false, sample_size: points.length, overall_avg_er: null, median_length: null,
    buckets: [], best: null, matches_best: null, headline: null, tip: null,
  };
  if (points.length < MIN_SAMPLE) return empty;

  const overall = mean(points.map((p) => p.er));
  if (overall == null || overall <= 0) return empty;
  const liftOf = (avg: number | null): number | null => (avg == null ? null : Math.round(((avg - overall) / overall) * 100));
  const medianLen = median(points.map((p) => p.len));

  // Group ERs by band.
  const grouped = new Map<string, number[]>();
  for (const p of points) {
    const b = bandFor(p.len);
    (grouped.get(b.key) ?? grouped.set(b.key, []).get(b.key)!).push(p.er);
  }

  const buckets: LengthBucket[] = BANDS
    .map((b) => {
      const ers = grouped.get(b.key) ?? [];
      const avg = ers.length >= MIN_CELL ? mean(ers) : null;
      return {
        key: b.key, label: b.label, range: rangeLabel(b), lo: b.lo, hi: b.hi,
        count: ers.length, avg_er: avg, lift_pct: liftOf(avg), is_best: false,
      };
    })
    .filter((b) => b.count > 0);   // only bands the creator actually posts in

  // Best = qualified band (enough posts) with the highest avg ER.
  const qualified = buckets.filter((b) => b.avg_er != null).sort((a, b) => (b.avg_er as number) - (a.avg_er as number));
  const best = qualified[0] ?? null;
  if (best) best.is_best = true;

  if (!best) {
    // Have posts but no band clears MIN_CELL — report length only, no verdict.
    return {
      ...empty, available: true, overall_avg_er: overall, median_length: medianLen, buckets,
      headline: 'Not enough posts in any single length band yet to call a sweet spot.',
      tip: 'Keep posting — once a length band has a few posts, we can tell you which length your audience rewards.',
    };
  }

  const medianBand = medianLen != null ? bandFor(medianLen) : null;
  const matches_best = medianBand != null ? medianBand.key === best.key : null;

  const liftClause = best.lift_pct != null && best.lift_pct > 0 ? ` — ${best.lift_pct}% above your average` : '';
  const headline = `Your ${best.label.toLowerCase()} captions (${best.range}) engage best${liftClause}.`;
  const tip = matches_best === true
    ? `You're already writing in your strongest band (${best.range}) — keep it there and put the effort into the opening line.`
    : matches_best === false
      ? `You usually write ~${medianLen} characters, but your ${best.label.toLowerCase()} captions (${best.range}) do better. Try shifting your next few posts toward that length.`
      : `Aim your next few captions at the ${best.label.toLowerCase()} band (${best.range}) and watch whether engagement holds.`;

  return {
    available: true,
    sample_size: points.length,
    overall_avg_er: overall,
    median_length: medianLen,
    buckets,
    best,
    matches_best,
    headline,
    tip,
  };
}
