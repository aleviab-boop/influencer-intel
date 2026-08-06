// ============================================================
// Content pillars — most creators circle a handful of recurring themes without
// ever naming them. This clusters posts into those pillars (from the hashtags
// and keywords their captions actually use), then sets each pillar's ENGAGEMENT
// against how OFTEN it's posted. The gold is the mismatch: a theme that engages
// well but barely gets posted is an under-used winner; one posted constantly for
// mediocre returns is over-invested. It turns a content calendar into a portfolio.
//
// Pure and deterministic: pillars are frequent caption terms/hashtags, posts are
// assigned to their strongest matching term, engagement is the ER the route
// already computed. No ML, no LLM, no clustering black box. Directional on a
// small sample — it names patterns, it doesn't dictate.
// ============================================================

export interface PillarPost {
  caption: string | null;
  er: number | null;
}

export interface ContentPillar {
  key: string;
  label: string;               // human-friendly theme name
  count: number;               // posts in this pillar
  share_pct: number;           // % of categorised posts
  avg_er: number | null;
  er_index: number | null;     // avg_er ÷ overall avg (1.0 = on par)
  verdict: 'scale_up' | 'keep' | 'reduce' | 'testing';
  note: string;
}

export interface ContentPillars {
  available: boolean;
  sample_size: number;
  categorised: number;
  overall_avg_er: number | null;
  pillars: ContentPillar[];
  best_pillar: ContentPillar | null;
  opportunity: ContentPillar | null;   // the standout under-used winner, if any
  headline: string | null;
  tip: string | null;
}

const MIN_SAMPLE = 6;
const MIN_PILLAR_POSTS = 2;

// Common words that never make a theme.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'me', 'us', 'them',
  'so', 'as', 'up', 'out', 'not', 'no', 'yes', 'do', 'does', 'did', 'have', 'has', 'had',
  'get', 'got', 'can', 'will', 'just', 'now', 'new', 'all', 'more', 'one', 'like', 'day',
  'today', 'here', 'there', 'when', 'what', 'how', 'why', 'who', 'about', 'some', 'any',
  'love', 'best', 'good', 'great', 'time', 'want', 'need', 'make', 'made', 'let', 'go',
  'am', 'pm', 'link', 'bio', 'follow', 'comment', 'share', 'save', 'tag', 'dm',
]);

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);
const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function hashtags(caption: string): string[] {
  return (caption.match(/#([\p{L}\p{N}_]+)/gu) ?? []).map((h) => h.slice(1).toLowerCase());
}
function words(caption: string): string[] {
  const noTags = caption.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/https?:\/\/\S+/g, ' ');
  return (noTags.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []);
}

export function analyzeContentPillars(posts: PillarPost[]): ContentPillars {
  const usable = posts
    .filter((p) => p.er != null && p.er > 0 && p.caption && p.caption.trim().length > 0)
    .map((p) => ({ caption: p.caption as string, er: p.er as number }));

  const empty: ContentPillars = {
    available: false, sample_size: usable.length, categorised: 0, overall_avg_er: null,
    pillars: [], best_pillar: null, opportunity: null, headline: null, tip: null,
  };
  if (usable.length < MIN_SAMPLE) return empty;

  const overallAvg = mean(usable.map((p) => p.er));

  // ---- Candidate theme terms: frequent hashtags (weighted) + caption keywords.
  const termDocFreq = new Map<string, number>();   // in how many posts the term appears
  const termIsTag = new Map<string, boolean>();
  for (const p of usable) {
    const seen = new Set<string>();
    for (const h of hashtags(p.caption)) {
      if (h.length < 3 || STOP.has(h)) continue;
      if (!seen.has(h)) { seen.add(h); termDocFreq.set(h, (termDocFreq.get(h) ?? 0) + 1); termIsTag.set(h, true); }
    }
    for (const w of words(p.caption)) {
      if (STOP.has(w)) continue;
      if (!seen.has(w)) { seen.add(w); termDocFreq.set(w, (termDocFreq.get(w) ?? 0) + 1); if (!termIsTag.has(w)) termIsTag.set(w, false); }
    }
  }

  // Candidate pillars = terms used in ≥2 posts. Hashtags rank ahead of plain
  // words at equal frequency (a deliberate theme signal beats an incidental word).
  const candidates = [...termDocFreq.entries()]
    .filter(([, df]) => df >= MIN_PILLAR_POSTS)
    .sort((a, b) => (b[1] - a[1]) || (Number(termIsTag.get(b[0])) - Number(termIsTag.get(a[0]))))
    .map(([term]) => term);

  if (!candidates.length) return empty;

  // ---- Assign each post to its single strongest candidate term ------------
  const rank = new Map(candidates.map((t, i) => [t, i]));   // lower = stronger
  const buckets = new Map<string, number[]>();              // term → ERs
  let categorised = 0;
  for (const p of usable) {
    const present = new Set<string>([...hashtags(p.caption), ...words(p.caption)]);
    let best: string | null = null;
    let bestRank = Infinity;
    for (const t of present) {
      const r = rank.get(t);
      if (r != null && r < bestRank) { bestRank = r; best = t; }
    }
    if (best) {
      (buckets.get(best) ?? buckets.set(best, []).get(best)!).push(p.er);
      categorised++;
    }
  }

  if (categorised < MIN_SAMPLE) return empty;

  // ---- Build pillars ------------------------------------------------------
  const avgShare = 100 / Math.max(1, buckets.size);   // even-split baseline
  const raw: ContentPillar[] = [];
  for (const [term, ers] of buckets) {
    if (ers.length < MIN_PILLAR_POSTS) continue;
    const avg = mean(ers);
    const share = Math.round((ers.length / categorised) * 100);
    const idx = avg != null && overallAvg != null && overallAvg > 0 ? Math.round((avg / overallAvg) * 100) / 100 : null;

    const above = idx != null && idx >= 1.1;
    const below = idx != null && idx <= 0.9;
    const posted_a_lot = share >= avgShare;

    let verdict: ContentPillar['verdict'];
    let note: string;
    if (above && !posted_a_lot) { verdict = 'scale_up'; note = 'Engages above average but you rarely post it — do more.'; }
    else if (above) { verdict = 'keep'; note = 'A reliable winner — keep it in rotation.'; }
    else if (below && posted_a_lot) { verdict = 'reduce'; note = 'Posted often for below-average returns — dial it back or refresh the angle.'; }
    else { verdict = 'testing'; note = 'Roughly on par — worth a few more posts to read the signal.'; }

    raw.push({ key: term, label: titleCase(term), count: ers.length, share_pct: share, avg_er: avg, er_index: idx, verdict, note });
  }

  if (!raw.length) return empty;

  // Rank by engagement index (winners first), keep the top themes.
  raw.sort((a, b) => (b.er_index ?? 0) - (a.er_index ?? 0) || b.count - a.count);
  const pillars = raw.slice(0, 6);

  const best_pillar = pillars[0] ?? null;
  const opportunity = pillars.find((p) => p.verdict === 'scale_up') ?? null;

  let headline: string | null = null;
  let tip: string | null = null;
  if (best_pillar) {
    const liftPct = best_pillar.er_index != null ? Math.round((best_pillar.er_index - 1) * 100) : null;
    headline = opportunity
      ? `“${opportunity.label}” is your under-used winner — it engages ${opportunity.er_index != null ? `${Math.round((opportunity.er_index - 1) * 100)}% above average` : 'well'} but is only ${opportunity.share_pct}% of your posts.`
      : `“${best_pillar.label}” is your strongest theme${liftPct != null && liftPct > 0 ? `, engaging ${liftPct}% above your average` : ''}.`;
    tip = opportunity
      ? `Shift some slots toward “${opportunity.label}” — it's earning more attention per post than the themes you lean on most.`
      : `Lean into “${best_pillar.label}” and trim the themes that engage below average.`;
  }

  return {
    available: pillars.length > 0,
    sample_size: usable.length,
    categorised,
    overall_avg_er: overallAvg,
    pillars,
    best_pillar,
    opportunity,
    headline,
    tip,
  };
}
