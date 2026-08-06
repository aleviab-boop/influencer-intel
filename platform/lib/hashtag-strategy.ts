// ============================================================
// Hashtag strategy — most creators recycle the same tag block on autopilot,
// half of it dead weight. This grades each hashtag by how posts that USE it
// engage versus the creator's average, sorting them into keep / drop / test
// tiers, and separately reads whether they're over- or under-tagging by
// comparing engagement across low / medium / high tag-count posts. The result
// is a tighter, evidence-backed tag set instead of a copy-pasted wall.
//
// Pure and deterministic: per-tag ER lift + a count-bucket comparison over the
// captions the route already fetched. No ML, no LLM. Directional on a small
// sample — a tag needs a couple of uses before its signal means much.
// ============================================================

export interface HashtagPost {
  caption: string | null;
  er: number | null;
}

export interface HashtagVerdict {
  tag: string;
  count: number;
  avg_er: number | null;
  lift_pct: number | null;   // vs the creator's overall avg ER
  tier: 'keep' | 'drop' | 'test';
}

export interface HashtagStrategy {
  available: boolean;
  sample_size: number;         // posts with captions considered
  tagged_posts: number;        // how many actually used ≥1 hashtag
  overall_avg_er: number | null;
  avg_per_post: number | null; // avg hashtags per tagged post
  count_advice: string | null; // over/under-tagging read from count buckets
  tags: HashtagVerdict[];
  keep: string[];
  drop: string[];
  headline: string | null;
  tip: string | null;
}

const MIN_SAMPLE = 6;
const MIN_TAG_USES = 2;      // a tag needs ≥2 uses before we grade keep/drop
const KEEP_LIFT = 8;         // ≥ +8% vs your avg → keep
const DROP_LIFT = -8;        // ≤ -8% vs your avg → drop

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

function hashtagsOf(caption: string): string[] {
  const raw = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  // Dedupe within a post (a tag repeated in one caption still counts once).
  return [...new Set(raw.map((h) => h.toLowerCase()))];
}

export function analyzeHashtagStrategy(posts: HashtagPost[]): HashtagStrategy {
  const usable = posts
    .filter((p) => p.er != null && p.er > 0 && p.caption && p.caption.trim().length > 0)
    .map((p) => ({ tags: hashtagsOf(p.caption as string), er: p.er as number }));

  const empty: HashtagStrategy = {
    available: false, sample_size: usable.length, tagged_posts: 0, overall_avg_er: null,
    avg_per_post: null, count_advice: null, tags: [], keep: [], drop: [], headline: null, tip: null,
  };
  if (usable.length < MIN_SAMPLE) return empty;

  const overallAvg = mean(usable.map((p) => p.er));
  if (overallAvg == null || overallAvg <= 0) return empty;

  const tagged = usable.filter((p) => p.tags.length > 0);
  if (tagged.length < 3) return empty;   // not enough hashtag usage to advise on
  const avgPerPost = Math.round((tagged.reduce((s, p) => s + p.tags.length, 0) / tagged.length) * 10) / 10;

  // ---- Per-tag engagement -------------------------------------------------
  const byTag = new Map<string, number[]>();
  for (const p of usable) {
    for (const t of p.tags) (byTag.get(t) ?? byTag.set(t, []).get(t)!).push(p.er);
  }

  const graded: HashtagVerdict[] = [];
  for (const [tag, ers] of byTag) {
    const avg = mean(ers);
    const lift = avg != null ? Math.round(((avg - overallAvg) / overallAvg) * 100) : null;
    let tier: HashtagVerdict['tier'];
    if (ers.length < MIN_TAG_USES) tier = 'test';
    else if (lift != null && lift >= KEEP_LIFT) tier = 'keep';
    else if (lift != null && lift <= DROP_LIFT) tier = 'drop';
    else tier = 'test';
    graded.push({ tag, count: ers.length, avg_er: avg, lift_pct: lift, tier });
  }

  // Sort: keepers by lift desc, then droppers by lift asc, tests by usage.
  const tierRank = { keep: 0, drop: 1, test: 2 } as const;
  graded.sort((a, b) => {
    if (tierRank[a.tier] !== tierRank[b.tier]) return tierRank[a.tier] - tierRank[b.tier];
    if (a.tier === 'drop') return (a.lift_pct ?? 0) - (b.lift_pct ?? 0);
    if (a.tier === 'test') return b.count - a.count;
    return (b.lift_pct ?? 0) - (a.lift_pct ?? 0);
  });

  const keep = graded.filter((g) => g.tier === 'keep').map((g) => g.tag);
  const drop = graded.filter((g) => g.tier === 'drop').map((g) => g.tag);

  // ---- Count buckets: are they over/under-tagging? -----------------------
  const bucket = (n: number): 'low' | 'mid' | 'high' => (n <= 2 ? 'low' : n <= 8 ? 'mid' : 'high');
  const buckets: Record<'low' | 'mid' | 'high', number[]> = { low: [], mid: [], high: [] };
  for (const p of usable) buckets[bucket(p.tags.length)].push(p.er);
  const bucketAvg = {
    low: mean(buckets.low), mid: mean(buckets.mid), high: mean(buckets.high),
  };
  const LABEL = { low: '0–2 tags', mid: '3–8 tags', high: '9+ tags' } as const;
  const ranked = (['low', 'mid', 'high'] as const)
    .filter((k) => buckets[k].length >= 2 && bucketAvg[k] != null)
    .sort((a, b) => (bucketAvg[b] as number) - (bucketAvg[a] as number));
  let count_advice: string | null = null;
  if (ranked.length >= 2) {
    const best = ranked[0]!;
    const bestLift = Math.round((((bucketAvg[best] as number) - overallAvg) / overallAvg) * 100);
    count_advice = `Posts with ${LABEL[best]} engage best for you${bestLift > 0 ? ` (${bestLift}% above average)` : ''}${avgPerPost != null ? ` — you average ${avgPerPost}` : ''}.`;
  }

  // ---- Narrative ---------------------------------------------------------
  let headline: string;
  if (keep.length) {
    headline = `${keep.length} hashtag${keep.length === 1 ? '' : 's'} clearly lift your reach — build your set around ${keep.slice(0, 3).map((t) => `${t}`).join(', ')}.`;
  } else if (drop.length) {
    headline = `None of your repeated hashtags are pulling their weight — time to refresh the block.`;
  } else {
    headline = `Your hashtag signal is still thin — keep testing to see which ones earn their place.`;
  }

  let tip: string;
  if (drop.length) {
    tip = `Retire ${drop.slice(0, 3).map((t) => `${t}`).join(', ')}${drop.length > 3 ? ' and other dead-weight tags' : ''} — they sit below your average. Replace them with fresh, more niche tags to test.`;
  } else if (avgPerPost != null && avgPerPost > 12) {
    tip = `You average ${avgPerPost} tags per post — trim to a focused set of your proven keepers plus a few fresh tests.`;
  } else {
    tip = `Lock in your keepers and rotate 2–3 new hashtags each week to keep finding winners.`;
  }

  return {
    available: true,
    sample_size: usable.length,
    tagged_posts: tagged.length,
    overall_avg_er: overallAvg,
    avg_per_post: avgPerPost,
    count_advice,
    tags: graded.slice(0, 12),
    keep,
    drop,
    headline,
    tip,
  };
}
