// ============================================================
// Content-strategy analysis from post captions + engagement.
//
// Two views a creator (and a brand) actually care about:
//   • Hashtag performance — which tags ride along with your best posts.
//   • Sponsored vs organic — does branded content hold up against your
//     regular posts, or does the audience tune out?
//
// All parsed from captions/insights we already fetched — no extra Graph calls.
// ============================================================

export interface ContentPost {
  media_type: string;
  caption: string | null;
  er: number | null;
  reach: number | null;
}

export interface HashtagStat {
  tag: string;
  count: number;
  avg_er: number | null;
}

export interface GroupStat {
  count: number;
  avg_er: number | null;
  avg_reach: number | null;
}

export interface ContentAnalysis {
  hashtags: HashtagStat[];           // used >=2x, ranked by avg ER
  total_unique_hashtags: number;
  avg_hashtags_per_post: number | null;
  sponsored: GroupStat;
  organic: GroupStat;
  // organic ER minus sponsored ER, as a fraction of organic (null if either side empty).
  sponsored_er_delta_pct: number | null;
}

// Signals that a post is branded/sponsored. Deliberately broad but not so loose
// that a stray "partner" in prose triggers it — we key on tags + set phrases.
const SPONSORED_MARKERS = [
  '#ad', '#ads', '#sponsored', '#sponsor', '#paidpartnership', '#paidpartner',
  '#paid', '#collab', '#collaboration', '#ambassador', '#brandpartner',
  '#gifted', '#partnership', 'paid partnership', 'sponsored by', 'in partnership with',
  'brand ambassador',
];

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

function extractHashtags(caption: string | null): string[] {
  if (!caption) return [];
  const matches = caption.toLowerCase().match(/#[\p{L}0-9_]+/gu) ?? [];
  // De-dupe within a single post so one post can't inflate a tag's count.
  return Array.from(new Set(matches));
}

function isSponsored(caption: string | null): boolean {
  if (!caption) return false;
  const c = caption.toLowerCase();
  return SPONSORED_MARKERS.some((m) => c.includes(m));
}

function groupStat(posts: ContentPost[]): GroupStat {
  const ers = posts.map((p) => p.er).filter((v): v is number => v != null && v > 0);
  const reaches = posts.map((p) => p.reach).filter((v): v is number => v != null && v > 0);
  return {
    count: posts.length,
    avg_er: mean(ers),
    avg_reach: reaches.length ? Math.round(mean(reaches)!) : null,
  };
}

export function analyzeContent(posts: ContentPost[]): ContentAnalysis {
  // ---- Hashtags --------------------------------------------------------
  const tagMap = new Map<string, { count: number; erSum: number; erN: number }>();
  let tagOccurrences = 0;
  for (const p of posts) {
    const tags = extractHashtags(p.caption);
    tagOccurrences += tags.length;
    for (const t of tags) {
      const e = tagMap.get(t) ?? { count: 0, erSum: 0, erN: 0 };
      e.count += 1;
      if (p.er != null && p.er > 0) { e.erSum += p.er; e.erN += 1; }
      tagMap.set(t, e);
    }
  }

  const hashtags: HashtagStat[] = Array.from(tagMap.entries())
    .filter(([, v]) => v.count >= 2)                       // needs repetition to be meaningful
    .map(([tag, v]) => ({ tag, count: v.count, avg_er: v.erN ? v.erSum / v.erN : null }))
    .sort((a, b) => (b.avg_er ?? 0) - (a.avg_er ?? 0) || b.count - a.count)
    .slice(0, 8);

  const avgHashtagsPerPost = posts.length ? Math.round((tagOccurrences / posts.length) * 10) / 10 : null;

  // ---- Sponsored vs organic -------------------------------------------
  const sponsoredPosts = posts.filter((p) => isSponsored(p.caption));
  const organicPosts = posts.filter((p) => !isSponsored(p.caption));
  const sponsored = groupStat(sponsoredPosts);
  const organic = groupStat(organicPosts);

  let delta: number | null = null;
  if (sponsored.avg_er != null && organic.avg_er != null && organic.avg_er > 0) {
    delta = Math.round(((organic.avg_er - sponsored.avg_er) / organic.avg_er) * 1000) / 10;
  }

  return {
    hashtags,
    total_unique_hashtags: tagMap.size,
    avg_hashtags_per_post: avgHashtagsPerPost,
    sponsored,
    organic,
    sponsored_er_delta_pct: delta,
  };
}
