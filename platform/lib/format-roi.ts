// ============================================================
// Format ROI — a creator spends very different effort on a Reel vs a photo, so
// the question isn't just "what engages best" but "what engages best per format,
// and am I spending my effort in the right place?" This compares average
// engagement (and reach, where available) across the three formats — Reels,
// carousels, single photos — against how OFTEN the creator posts each, and flags
// the mismatch: the format that out-performs but is under-used, or the one
// soaking up slots without paying for them.
//
// Pure and deterministic: mean ER / reach per media type over the posts the
// route already fetched, only trusting formats with enough posts. No ML, no LLM.
// Directional — it reflects this creator's mix, not a universal ranking.
// ============================================================

export interface FormatPost {
  media_type: string;
  er: number | null;
  reach: number | null;
}

export interface FormatStat {
  key: string;
  label: string;
  count: number;
  share_pct: number;        // % of analyzed posts in this format
  avg_er: number | null;
  avg_reach: number | null;
  lift_pct: number | null;  // ER vs overall average
  is_best: boolean;
}

export interface FormatRoi {
  available: boolean;
  sample_size: number;
  overall_avg_er: number | null;
  formats: FormatStat[];
  best: FormatStat | null;
  headline: string | null;
  tip: string | null;
}

const MIN_SAMPLE = 6;   // total posts before we say anything
const MIN_CELL = 2;     // posts a format needs before we trust its average

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

function formatKey(mediaType: string): { key: string; label: string } {
  const t = (mediaType ?? '').toUpperCase();
  if (t === 'VIDEO' || t === 'REELS') return { key: 'reel', label: 'Reels' };
  if (t === 'CAROUSEL_ALBUM' || t === 'CAROUSEL') return { key: 'carousel', label: 'Carousels' };
  return { key: 'photo', label: 'Single photos' };
}

const ORDER = ['reel', 'carousel', 'photo'];

export function analyzeFormatRoi(posts: FormatPost[]): FormatRoi {
  const points = posts
    .map((p) => ({ fmt: formatKey(p.media_type), er: Number(p.er), reach: Number(p.reach) }))
    .filter((p) => Number.isFinite(p.er) && p.er > 0);

  const empty: FormatRoi = {
    available: false, sample_size: points.length, overall_avg_er: null,
    formats: [], best: null, headline: null, tip: null,
  };
  if (points.length < MIN_SAMPLE) return empty;

  const overall = mean(points.map((p) => p.er));
  if (overall == null || overall <= 0) return empty;
  const liftOf = (avg: number | null): number | null => (avg == null ? null : Math.round(((avg - overall) / overall) * 100));

  const grouped = new Map<string, { label: string; ers: number[]; reaches: number[] }>();
  for (const p of points) {
    const g = grouped.get(p.fmt.key) ?? { label: p.fmt.label, ers: [], reaches: [] };
    g.ers.push(p.er);
    if (Number.isFinite(p.reach) && p.reach > 0) g.reaches.push(p.reach);
    grouped.set(p.fmt.key, g);
  }

  const total = points.length;
  const formats: FormatStat[] = [...grouped.entries()]
    .map(([key, g]) => {
      const avg = g.ers.length >= MIN_CELL ? mean(g.ers) : null;
      return {
        key, label: g.label, count: g.ers.length,
        share_pct: Math.round((g.ers.length / total) * 100),
        avg_er: avg,
        avg_reach: g.reaches.length ? Math.round(mean(g.reaches) as number) : null,
        lift_pct: liftOf(avg),
        is_best: false,
      };
    })
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  const qualified = formats.filter((f) => f.avg_er != null).sort((a, b) => (b.avg_er as number) - (a.avg_er as number));
  const best = qualified[0] ?? null;
  if (best) best.is_best = true;

  if (!best || qualified.length < 2) {
    // Only one format has enough posts — nothing to compare.
    return {
      ...empty, available: true, overall_avg_er: overall, formats, best,
      headline: best ? `Almost everything you post is ${best.label.toLowerCase()} — not enough variety yet to compare formats.` : null,
      tip: 'Mix in another format or two so we can tell you which one your audience rewards most.',
    };
  }

  const worst = qualified[qualified.length - 1]!;
  const liftClause = best.lift_pct != null && best.lift_pct > 0 ? ` — ${best.lift_pct}% above your average` : '';
  const headline = `${best.label} are your highest-ROI format${liftClause}.`;

  // Under-used winner: best format engages well but is a minority of the mix.
  const underUsed = best.share_pct < 40 && (best.lift_pct ?? 0) >= 10;
  const overUsed = worst.share_pct >= 40 && (worst.lift_pct ?? 0) <= -10;
  const tip = underUsed
    ? `You post ${best.label.toLowerCase()} only ${best.share_pct}% of the time, yet they engage best. Shift a few slots from ${worst.label.toLowerCase()} toward ${best.label.toLowerCase()}.`
    : overUsed
      ? `${worst.label} are ${worst.share_pct}% of your posts but engage below your average. Trade some of those slots for ${best.label.toLowerCase()}.`
      : `Your mix roughly matches what works — keep leaning on ${best.label.toLowerCase()}, and use ${worst.label.toLowerCase()} where they serve a purpose beyond reach.`;

  return {
    available: true,
    sample_size: points.length,
    overall_avg_er: overall,
    formats,
    best,
    headline,
    tip,
  };
}
