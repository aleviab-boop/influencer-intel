// ============================================================
// Caption & hook analysis — how a creator WRITES vs how posts perform.
//
// Instagram rewards captions that spark replies and dwell time, but most
// creators never see whether their own writing habits actually help. This
// module correlates three cheap, caption-only signals with engagement:
//
//   • Length     — do short or long captions land better for THIS creator?
//   • Emojis     — does emoji use track with higher ER?
//   • CTA / hooks — do captions that ask a question or add a call-to-action
//                   ("comment", "save this", "tag a friend") out-engage flat ones?
//
// Everything is parsed from captions we already fetched — no extra Graph
// calls. Each comparison only surfaces when there's a real sample on BOTH
// sides, so we never invent a trend from one post.
// ============================================================

export interface CaptionPost {
  caption: string | null;
  er: number | null;
}

export interface LengthBucket {
  key: 'short' | 'medium' | 'long';
  label: string;
  count: number;
  avg_er: number | null;
}

export interface CaptionSplit {
  // ER of posts WITH the trait vs WITHOUT it, plus how many fall each side.
  with_count: number;
  without_count: number;
  with_er: number | null;
  without_er: number | null;
  // (with − without) / without, as a % — positive = the trait helps this creator.
  lift_pct: number | null;
}

export interface CaptionAnalysis {
  available: boolean;
  sample_size: number;
  avg_caption_chars: number | null;
  emoji_usage_pct: number | null;       // share of posts using >=1 emoji
  question_usage_pct: number | null;    // share of posts asking a question
  cta_usage_pct: number | null;         // share of posts with a call-to-action
  length_buckets: LengthBucket[];
  best_length: 'short' | 'medium' | 'long' | null;
  emoji_split: CaptionSplit | null;
  cta_split: CaptionSplit | null;       // question OR CTA vs neither
  // Highest-confidence single takeaway for the dashboard headline.
  headline: string | null;
}

// Length thresholds in characters. Short = a one-liner, long = a mini-blog.
const SHORT_MAX = 100;
const MEDIUM_MAX = 300;

// Call-to-action phrasing. Kept to unambiguous engagement asks so a stray
// "save" in prose is less likely to false-positive.
const CTA_MARKERS = [
  'comment below', 'comment ', 'tag a friend', 'tag someone', 'tag your',
  'save this', 'save it', 'save for later', 'share this', 'share with',
  'send this to', 'drop a', 'let me know', 'link in bio', 'swipe',
  'double tap', 'follow for', 'sign up', 'shop now', 'check out',
];

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

// Emoji detection via the Unicode Emoji property (covers most pictographs).
const EMOJI_RE = /\p{Extended_Pictographic}/u;
function hasEmoji(caption: string): boolean {
  return EMOJI_RE.test(caption);
}

function hasQuestion(caption: string): boolean {
  return caption.includes('?');
}

function hasCta(caption: string): boolean {
  const c = caption.toLowerCase();
  return CTA_MARKERS.some((m) => c.includes(m));
}

function lengthKey(chars: number): LengthBucket['key'] {
  if (chars <= SHORT_MAX) return 'short';
  if (chars <= MEDIUM_MAX) return 'medium';
  return 'long';
}

/** ER of a subset of posts (positive ER only, to ignore missing data). */
function subsetEr(posts: CaptionPost[]): number | null {
  return mean(posts.map((p) => p.er).filter((v): v is number => v != null && v > 0));
}

/**
 * Split posts by a boolean caption trait and compare engagement on each side.
 * Returns null unless both sides have >=2 posts with real ER — no trend from
 * a sample of one.
 */
function splitBy(posts: CaptionPost[], test: (c: string) => boolean): CaptionSplit | null {
  const withT = posts.filter((p) => p.caption && test(p.caption));
  const withoutT = posts.filter((p) => !p.caption || !test(p.caption));
  const withEr = subsetEr(withT);
  const withoutEr = subsetEr(withoutT);
  const withN = withT.filter((p) => p.er != null && p.er > 0).length;
  const withoutN = withoutT.filter((p) => p.er != null && p.er > 0).length;
  if (withN < 2 || withoutN < 2 || withEr == null || withoutEr == null || withoutEr <= 0) {
    return {
      with_count: withT.length, without_count: withoutT.length,
      with_er: withEr, without_er: withoutEr, lift_pct: null,
    };
  }
  return {
    with_count: withT.length,
    without_count: withoutT.length,
    with_er: withEr,
    without_er: withoutEr,
    lift_pct: Math.round(((withEr - withoutEr) / withoutEr) * 1000) / 10,
  };
}

const pctFmt = (v: number | null): string =>
  v != null && Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—';

export function analyzeCaptions(posts: CaptionPost[]): CaptionAnalysis {
  const withCaption = posts.filter((p) => p.caption && p.caption.trim().length > 0);
  const empty: CaptionAnalysis = {
    available: false, sample_size: withCaption.length,
    avg_caption_chars: null, emoji_usage_pct: null, question_usage_pct: null,
    cta_usage_pct: null, length_buckets: [], best_length: null,
    emoji_split: null, cta_split: null, headline: null,
  };
  if (withCaption.length < 4) return empty;

  const chars = withCaption.map((p) => p.caption!.trim().length);
  const avgChars = Math.round(mean(chars)!);

  const emojiN = withCaption.filter((p) => hasEmoji(p.caption!)).length;
  const questionN = withCaption.filter((p) => hasQuestion(p.caption!)).length;
  const ctaN = withCaption.filter((p) => hasCta(p.caption!)).length;

  // Length buckets with per-bucket ER.
  const bucketDefs: { key: LengthBucket['key']; label: string }[] = [
    { key: 'short', label: 'Short (≤100 chars)' },
    { key: 'medium', label: 'Medium (100–300)' },
    { key: 'long', label: 'Long (300+)' },
  ];
  const length_buckets: LengthBucket[] = bucketDefs.map(({ key, label }) => {
    const g = withCaption.filter((p) => lengthKey(p.caption!.trim().length) === key);
    return { key, label, count: g.length, avg_er: subsetEr(g) };
  });

  // Best length = highest avg ER among buckets with >=2 posts.
  let best_length: CaptionAnalysis['best_length'] = null;
  let bestEr = -1;
  for (const b of length_buckets) {
    if (b.count >= 2 && b.avg_er != null && b.avg_er > bestEr) {
      bestEr = b.avg_er;
      best_length = b.key;
    }
  }

  const emoji_split = splitBy(withCaption, hasEmoji);
  const cta_split = splitBy(withCaption, (c) => hasQuestion(c) || hasCta(c));

  // Headline = the strongest, clearest single finding (prefer big, real lifts).
  let headline: string | null = null;
  const candidates: { lift: number; text: string }[] = [];
  if (cta_split?.lift_pct != null && Math.abs(cta_split.lift_pct) >= 10) {
    candidates.push({
      lift: Math.abs(cta_split.lift_pct),
      text: cta_split.lift_pct > 0
        ? `Captions with a question or call-to-action get ${cta_split.lift_pct}% more engagement — keep asking your audience to act.`
        : `Your flat captions are out-performing your call-to-action ones by ${Math.abs(cta_split.lift_pct)}% — your CTAs may feel forced; try weaving them in naturally.`,
    });
  }
  if (emoji_split?.lift_pct != null && Math.abs(emoji_split.lift_pct) >= 10) {
    candidates.push({
      lift: Math.abs(emoji_split.lift_pct),
      text: emoji_split.lift_pct > 0
        ? `Posts with emojis pull ${emoji_split.lift_pct}% more engagement for you — the extra personality is landing.`
        : `Emoji-heavy captions under-perform your cleaner ones by ${Math.abs(emoji_split.lift_pct)}% — try letting the words carry it.`,
    });
  }
  if (best_length) {
    const b = length_buckets.find((x) => x.key === best_length)!;
    candidates.push({
      lift: 5, // low priority vs the split findings
      text: `Your ${best_length} captions average ${pctFmt(b.avg_er)} engagement — your best length. Lean into that rhythm.`,
    });
  }
  candidates.sort((a, b) => b.lift - a.lift);
  headline = candidates[0]?.text ?? null;

  return {
    available: true,
    sample_size: withCaption.length,
    avg_caption_chars: avgChars,
    emoji_usage_pct: Math.round((emojiN / withCaption.length) * 100),
    question_usage_pct: Math.round((questionN / withCaption.length) * 100),
    cta_usage_pct: Math.round((ctaN / withCaption.length) * 100),
    length_buckets,
    best_length,
    emoji_split,
    cta_split,
    headline,
  };
}
