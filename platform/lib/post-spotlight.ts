// ============================================================
// Post spotlight — the aggregate cards ("winning formula", "content pillars")
// tell you what your best posts have in common; this points at the ACTUAL posts.
// It surfaces the single strongest recent post and one notable under-performer,
// then explains each in plain English by comparing the traits it carries
// (format, timing, caption style, hashtags) against how those traits engage
// across the rest of the feed. Concrete "do more of this / rethink that",
// anchored to a real permalink the creator can open.
//
// Pure and deterministic: reasons are per-trait ER lifts measured over the same
// posts the route fetched. No ML, no LLM. Directional on a small sample.
// ============================================================

export interface SpotlightInput {
  id: string;
  permalink: string;
  thumbnail_url: string | null;
  media_url: string | null;
  media_type: string;
  caption: string | null;
  timestamp: string;
  er: number | null;
  like_count: number;
  comments_count: number;
}

export interface SpotlightCard {
  id: string;
  permalink: string;
  thumbnail_url: string | null;
  media_type: string;
  format_label: string;
  caption_excerpt: string | null;
  timestamp: string;
  er: number | null;
  vs_median_pct: number | null;   // how far above/below the creator's median ER
  likes: number;
  comments: number;
  reasons: string[];
  takeaway: string;
}

export interface PostSpotlight {
  available: boolean;
  sample_size: number;
  median_er: number | null;
  top: SpotlightCard | null;
  under: SpotlightCard | null;
  headline: string | null;
}

const MIN_SAMPLE = 6;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const CTA_MARKERS = ['comment', 'tag ', 'share', 'save ', 'follow', 'link in bio', 'dm ', 'drop a', 'let me know', 'tell me', 'sign up', 'shop', 'swipe'];

const isReel = (t: string): boolean => t === 'VIDEO' || t === 'REELS';
const isCarousel = (t: string): boolean => t === 'CAROUSEL_ALBUM';
const formatLabel = (t: string): string => (isReel(t) ? 'Reel' : isCarousel(t) ? 'Carousel' : 'Photo');

const IST_OFFSET_MIN = 5 * 60 + 30;
function istHour(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + IST_OFFSET_MIN * 60_000).getUTCHours();
}
function hasCTA(caption: string): boolean {
  const c = caption.toLowerCase();
  return c.includes('?') || CTA_MARKERS.some((m) => c.includes(m));
}
function hashtagCount(caption: string): number {
  return (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}
const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);
const medianOf = (nums: number[]): number | null => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

interface Trait {
  key: string;
  has: (p: SpotlightInput) => boolean;
  // Positive framing (why this helped) and cautionary framing (why this may have hurt).
  up: (lift: number) => string;
  down: (lift: number) => string;
}

const pctStr = (lift: number): string => `${lift >= 0 ? '+' : ''}${Math.round(lift)}%`;

const TRAITS: Trait[] = [
  { key: 'reel', has: (p) => isReel(p.media_type),
    up: (l) => `It's a Reel — your Reels engage ${pctStr(l)} vs other formats`,
    down: (l) => `Reels usually under-index for you (${pctStr(l)})` },
  { key: 'carousel', has: (p) => isCarousel(p.media_type),
    up: (l) => `It's a Carousel — those pull ${pctStr(l)} for you`,
    down: (l) => `Carousels tend to under-perform your feed (${pctStr(l)})` },
  { key: 'photo', has: (p) => !isReel(p.media_type) && !isCarousel(p.media_type),
    up: (l) => `A single photo — which over-indexes ${pctStr(l)} for you`,
    down: (l) => `Single photos lag your Reels/carousels (${pctStr(l)})` },
  { key: 'evening', has: (p) => { const h = istHour(p.timestamp); return h != null && (h >= 18 || h < 5); },
    up: (l) => `Posted in the evening/night — your best-performing window (${pctStr(l)})`,
    down: (l) => `Posted late — a softer window for you (${pctStr(l)})` },
  { key: 'short', has: (p) => { const l = p.caption?.trim().length ?? 0; return l > 0 && l <= 100; },
    up: (l) => `Short, punchy caption — those land ${pctStr(l)} for you`,
    down: (l) => `A very short caption — your longer ones do better (${pctStr(l)})` },
  { key: 'long', has: (p) => (p.caption?.trim().length ?? 0) >= 300,
    up: (l) => `A longer, story-style caption — worth ${pctStr(l)} on your feed`,
    down: (l) => `A long caption where your shorter ones win (${pctStr(l)})` },
  { key: 'question', has: (p) => (p.caption ? hasCTA(p.caption) : false),
    up: (l) => `Opens a question / call-to-action — adds ${pctStr(l)} for you`,
    down: (l) => `No clear question or CTA — those cost you (${pctStr(l)})` },
  { key: 'emoji', has: (p) => (p.caption ? EMOJI_RE.test(p.caption) : false),
    up: (l) => `Uses emojis — a small ${pctStr(l)} lift on your posts`,
    down: (l) => `No emojis, which slightly help you (${pctStr(l)})` },
  { key: 'tags', has: (p) => (p.caption ? hashtagCount(p.caption) >= 3 : false),
    up: (l) => `Three or more hashtags — worth ${pctStr(l)} for reach`,
    down: (l) => `Few/no hashtags, which tend to help you (${pctStr(l)})` },
];

// ER lift (%) of posts WITH a trait vs posts WITHOUT it, across the whole set.
function traitLift(all: SpotlightInput[], t: Trait): number | null {
  const withEr = all.filter((p) => t.has(p)).map((p) => p.er as number);
  const withoutEr = all.filter((p) => !t.has(p)).map((p) => p.er as number);
  const a = mean(withEr), b = mean(withoutEr);
  if (a == null || b == null || b <= 0) return null;
  return ((a - b) / b) * 100;
}

function excerpt(caption: string | null): string | null {
  if (!caption) return null;
  const first = caption.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? caption.trim();
  return first.length > 90 ? first.slice(0, 87).trimEnd() + '…' : first;
}

function buildCard(
  post: SpotlightInput, all: SpotlightInput[], median: number, mode: 'top' | 'under',
): SpotlightCard {
  // Rank the post's own traits by how strongly each trait moves ER on this feed.
  const scored = TRAITS
    .filter((t) => t.has(post))
    .map((t) => ({ t, lift: traitLift(all, t) }))
    .filter((x): x is { t: Trait; lift: number } => x.lift != null);

  let reasons: string[];
  if (mode === 'top') {
    reasons = scored.filter((x) => x.lift > 3).sort((a, b) => b.lift - a.lift).slice(0, 3)
      .map((x) => x.t.up(x.lift));
    if (!reasons.length) {
      reasons = scored.sort((a, b) => b.lift - a.lift).slice(0, 2).map((x) => x.t.up(x.lift));
    }
  } else {
    // For the under-performer, call out the traits that drag ER down for this creator.
    reasons = scored.filter((x) => x.lift < -3).sort((a, b) => a.lift - b.lift).slice(0, 3)
      .map((x) => x.t.down(x.lift));
    if (!reasons.length) reasons = ['Nothing structurally wrong — likely just topic or timing luck on the day.'];
  }

  const vs = median > 0 && post.er != null ? Math.round(((post.er - median) / median) * 100) : null;
  const takeaway = mode === 'top'
    ? `Replicate the recipe above — it beat your median by ${vs != null ? `${vs}%` : 'a clear margin'}.`
    : `Ran ${vs != null ? `${Math.abs(vs)}% below` : 'below'} your median — a useful contrast, not a failure.`;

  return {
    id: post.id,
    permalink: post.permalink,
    thumbnail_url: post.thumbnail_url ?? post.media_url ?? null,
    media_type: post.media_type,
    format_label: formatLabel(post.media_type),
    caption_excerpt: excerpt(post.caption),
    timestamp: post.timestamp,
    er: post.er,
    vs_median_pct: vs,
    likes: post.like_count,
    comments: post.comments_count,
    reasons,
    takeaway,
  };
}

export function analyzePostSpotlight(posts: SpotlightInput[]): PostSpotlight {
  const usable = posts.filter((p) => p.er != null && p.er > 0);

  const empty: PostSpotlight = {
    available: false, sample_size: usable.length, median_er: null,
    top: null, under: null, headline: null,
  };
  if (usable.length < MIN_SAMPLE) return empty;

  const median = medianOf(usable.map((p) => p.er as number));
  if (median == null || median <= 0) return empty;

  const sorted = [...usable].sort((a, b) => (b.er as number) - (a.er as number));
  const topPost = sorted[0]!;
  const underPost = sorted[sorted.length - 1]!;

  const top = buildCard(topPost, usable, median, 'top');
  // Only show the under-performer if it's meaningfully below median (else skip).
  const under = (underPost.er as number) < median * 0.7 && underPost.id !== topPost.id
    ? buildCard(underPost, usable, median, 'under')
    : null;

  const headline = top.vs_median_pct != null
    ? `Your standout post beat your median engagement by ${top.vs_median_pct}% — here's what made it work.`
    : `Here's your strongest recent post and what set it apart.`;

  return {
    available: true,
    sample_size: usable.length,
    median_er: median,
    top,
    under,
    headline,
  };
}
