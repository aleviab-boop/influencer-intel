// ============================================================
// Winning formula — "what do your best posts have in common?".
//
// Every other content card looks at one dimension at a time (format, caption,
// timing…). This mines across all of them at once: split the creator's posts
// into their top performers vs the rest, then surface the traits that are
// markedly MORE common among the winners. The output is a short, plain recipe
// the creator can repeat.
//
// TRANSPARENT and deterministic: prevalence of each trait in the top group vs
// the rest, with the gap (lift) as the signal. No ML, no LLM. Directional — it
// describes correlations in a small sample, not guarantees.
// ============================================================

export interface FormulaPost {
  media_type: string;
  caption: string | null;
  timestamp: string;      // ISO, UTC
  er: number | null;
}

export interface FormulaTrait {
  key: string;
  label: string;
  top_pct: number;        // % of TOP posts with this trait
  rest_pct: number;       // % of the REST
  lift: number;           // top_pct − rest_pct (percentage points)
  strength: 'strong' | 'moderate';
}

export interface WinningFormula {
  available: boolean;
  sample_size: number;
  top_count: number;
  top_er_avg: number | null;
  rest_er_avg: number | null;
  traits: FormulaTrait[];
  recipe: string | null;
}

const isReel = (t: string): boolean => t === 'VIDEO' || t === 'REELS';
const isCarousel = (t: string): boolean => t === 'CAROUSEL_ALBUM';

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const CTA_MARKERS = ['comment', 'tag ', 'share', 'save ', 'follow', 'link in bio', 'dm ', 'drop a', 'let me know', 'tell me', 'sign up', 'shop', 'swipe'];

function hasCTA(caption: string): boolean {
  const c = caption.toLowerCase();
  if (c.includes('?')) return true;
  return CTA_MARKERS.some((m) => c.includes(m));
}

function hashtagCount(caption: string): number {
  return (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

const IST_OFFSET_MIN = 5 * 60 + 30;
function istHour(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + IST_OFFSET_MIN * 60_000).getUTCHours();
}

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

interface Trait { key: string; label: string; test: (p: FormulaPost) => boolean | null }

const TRAITS: Trait[] = [
  { key: 'reels', label: 'Reels', test: (p) => isReel(p.media_type) },
  { key: 'carousels', label: 'Carousels', test: (p) => isCarousel(p.media_type) },
  { key: 'photos', label: 'Single photos', test: (p) => !isReel(p.media_type) && !isCarousel(p.media_type) },
  { key: 'short', label: 'Short, punchy captions', test: (p) => { const l = p.caption?.trim().length ?? 0; return l > 0 && l <= 100; } },
  { key: 'long', label: 'Longer, story-style captions', test: (p) => (p.caption?.trim().length ?? 0) >= 300 },
  { key: 'emoji', label: 'Emojis in the caption', test: (p) => (p.caption ? EMOJI_RE.test(p.caption) : false) },
  { key: 'cta', label: 'A question or call-to-action', test: (p) => (p.caption ? hasCTA(p.caption) : false) },
  { key: 'tags', label: '3 or more hashtags', test: (p) => (p.caption ? hashtagCount(p.caption) >= 3 : false) },
  { key: 'evening', label: 'Posted in the evening/night (after 6pm IST)', test: (p) => { const h = istHour(p.timestamp); return h == null ? null : (h >= 18 || h < 5); } },
  { key: 'daytime', label: 'Posted during the day (before 6pm IST)', test: (p) => { const h = istHour(p.timestamp); return h == null ? null : (h >= 5 && h < 18); } },
];

const MIN_SAMPLE = 8;

export function analyzeWinningFormula(posts: FormulaPost[]): WinningFormula {
  const usable = posts.filter((p) => p.er != null && p.er > 0);
  const empty: WinningFormula = {
    available: false, sample_size: usable.length, top_count: 0,
    top_er_avg: null, rest_er_avg: null, traits: [], recipe: null,
  };
  if (usable.length < MIN_SAMPLE) return empty;

  // Rank by engagement; the top third are the "winners".
  const sorted = [...usable].sort((a, b) => (b.er as number) - (a.er as number));
  const topCount = Math.max(2, Math.round(sorted.length / 3));
  const top = sorted.slice(0, topCount);
  const rest = sorted.slice(topCount);
  if (rest.length < 2) return empty;

  const pctWith = (group: FormulaPost[], t: Trait): number => {
    const applicable = group.filter((p) => t.test(p) !== null);
    if (!applicable.length) return 0;
    const hits = applicable.filter((p) => t.test(p) === true).length;
    return Math.round((hits / applicable.length) * 100);
  };

  const traits: FormulaTrait[] = [];
  for (const t of TRAITS) {
    const topPct = pctWith(top, t);
    const restPct = pctWith(rest, t);
    const lift = topPct - restPct;
    // Keep traits that are both common in winners and clearly more common there.
    if (topPct >= 50 && lift >= 12) {
      traits.push({ key: t.key, label: t.label, top_pct: topPct, rest_pct: restPct, lift, strength: lift >= 30 ? 'strong' : 'moderate' });
    }
  }

  // De-conflict mutually-exclusive pairs (keep the stronger of each).
  const dropWeaker = (a: string, b: string) => {
    const ia = traits.findIndex((t) => t.key === a);
    const ib = traits.findIndex((t) => t.key === b);
    if (ia >= 0 && ib >= 0) {
      const weaker = traits[ia]!.lift >= traits[ib]!.lift ? b : a;
      const idx = traits.findIndex((t) => t.key === weaker);
      traits.splice(idx, 1);
    }
  };
  dropWeaker('short', 'long');
  dropWeaker('evening', 'daytime');

  traits.sort((a, b) => b.lift - a.lift);

  const topErAvg = mean(top.map((p) => p.er as number));
  const restErAvg = mean(rest.map((p) => p.er as number));

  const recipe = traits.length
    ? `Your best posts tend to be ${traits.slice(0, 3).map((t) => t.label.toLowerCase()).join(', ')}.`
    : null;

  return {
    available: traits.length > 0,
    sample_size: usable.length,
    top_count: topCount,
    top_er_avg: topErAvg,
    rest_er_avg: restErAvg,
    traits: traits.slice(0, 5),
    recipe,
  };
}
