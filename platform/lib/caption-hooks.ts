// ============================================================
// Caption hooks — the first line is what stops the scroll. This mines the
// OPENING of every caption, classifies it into a hook archetype (question,
// number/list, bold claim, how-to, story teaser, curiosity gap…), and works out
// which styles the creator's BEST posts lean on. The payoff is a short library
// of reusable hook templates, each backed by the creator's own top-performing
// example — copy the pattern, swap the topic, keep what already works.
//
// Pure and deterministic: derived from caption text + ER the route already
// fetched. No ML, no LLM — plain pattern rules on the first line. Directional on
// a small sample; it surfaces what's correlated with the creator's wins.
// ============================================================

export interface HookPost {
  caption: string | null;
  er: number | null;
  permalink?: string | null;
}

export interface HookArchetype {
  key: string;
  label: string;
  count: number;          // how many of the creator's posts open this way
  avg_er: number | null;  // avg ER of those posts
  is_winner: boolean;     // over-represented among top posts / above-median ER
  template: string;       // fill-in-the-blank pattern
  example: string | null; // the creator's own best-performing opener of this type
}

export interface CaptionHooks {
  available: boolean;
  sample_size: number;
  overall_avg_er: number | null;
  top_hook: HookArchetype | null;
  hooks: HookArchetype[];
  headline: string | null;
  tip: string | null;
}

const MIN_SAMPLE = 6;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

// Pull the opener: first line, else first sentence, capped so it's a hook not a
// paragraph. Strips leading hashtags/emojis-only noise.
function opener(caption: string): string {
  const firstLine = caption.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const base = firstLine || caption.trim();
  const sentence = base.split(/(?<=[.!?])\s/)[0] ?? base;
  return sentence.slice(0, 120).trim();
}

interface Rule { key: string; label: string; template: string; test: (o: string) => boolean }

const NUM_RE = /^\s*(\d+)\b|\b(\d+)\s+(ways|things|tips|reasons|steps|mistakes|signs|lessons|rules|hacks|habits)\b/i;
const HOWTO_RE = /\b(how to|here's how|the secret to|a guide to|step[- ]by[- ]step)\b/i;
const CLAIM_RE = /\b(the best|the worst|never|always|nobody|everyone|stop|the truth|honestly|unpopular opinion|hot take|this is why|the reason)\b/i;
const CURIOSITY_RE = /\b(you won't believe|wait for it|watch till|what happened|this changed|i didn't expect|plot twist|the one thing|little did)\b/i;
const STORY_RE = /^\s*(i |we |my |when i|last (week|year|month|night)|a few (years|months|weeks)|back (in|when))/i;
const YOU_RE = /^\s*(you|your|if you|ever (felt|wondered)|raise your hand|be honest)\b/i;

const RULES: Rule[] = [
  { key: 'question', label: 'Question opener', template: 'Ask the reader a question they instantly want answered — “{question}?”', test: (o) => o.includes('?') && o.indexOf('?') < 80 },
  { key: 'number', label: 'Number / listicle', template: 'Lead with a number — “{n} {things} that {payoff}”', test: (o) => NUM_RE.test(o) },
  { key: 'howto', label: 'How-to promise', template: 'Promise a clear outcome — “How to {result} (without {pain})”', test: (o) => HOWTO_RE.test(o) },
  { key: 'curiosity', label: 'Curiosity gap', template: 'Open a loop you only close later — “{setup}… and this is what happened”', test: (o) => CURIOSITY_RE.test(o) },
  { key: 'claim', label: 'Bold claim / hot take', template: 'Stake a strong opinion up front — “{bold statement}”', test: (o) => CLAIM_RE.test(o) },
  { key: 'story', label: 'Personal story teaser', template: 'Start mid-moment — “{when}, I {what happened}…”', test: (o) => STORY_RE.test(o) },
  { key: 'you', label: 'Direct “you” address', template: 'Talk straight to the reader — “You {relatable situation}”', test: (o) => YOU_RE.test(o) },
  { key: 'emoji', label: 'Emoji-led opener', template: 'Open with an emoji + a short punchy line — “✨ {one-line promise}”', test: (o) => EMOJI_RE.test(o.slice(0, 3)) },
];

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

function classify(o: string): string {
  for (const r of RULES) if (r.test(o)) return r.key;
  return 'plain';
}

export function analyzeCaptionHooks(posts: HookPost[]): CaptionHooks {
  const usable = posts
    .filter((p) => p.er != null && p.er > 0 && p.caption && p.caption.trim().length > 0)
    .map((p) => ({ opener: opener(p.caption as string), er: p.er as number }))
    .filter((p) => p.opener.length >= 3);

  const empty: CaptionHooks = {
    available: false, sample_size: usable.length, overall_avg_er: null,
    top_hook: null, hooks: [], headline: null, tip: null,
  };
  if (usable.length < MIN_SAMPLE) return empty;

  const overallAvg = mean(usable.map((p) => p.er));
  const sorted = [...usable].sort((a, b) => b.er - a.er);
  const topCut = Math.max(2, Math.round(sorted.length / 3));
  const topSet = new Set(sorted.slice(0, topCut));

  // Bucket by archetype.
  const buckets = new Map<string, { ers: number[]; topHits: number; best: { opener: string; er: number } | null }>();
  for (const p of usable) {
    const key = classify(p.opener);
    const b = buckets.get(key) ?? { ers: [], topHits: 0, best: null };
    b.ers.push(p.er);
    if (topSet.has(p)) b.topHits++;
    if (!b.best || p.er > b.best.er) b.best = { opener: p.opener, er: p.er };
    buckets.set(key, b);
  }

  const RULE_BY_KEY = new Map(RULES.map((r) => [r.key, r]));
  const hooks: HookArchetype[] = [];
  for (const [key, b] of buckets) {
    if (key === 'plain') continue;               // "no clear hook" isn't a template
    const rule = RULE_BY_KEY.get(key);
    if (!rule) continue;
    const avg = mean(b.ers);
    // A "winner" hook: above the creator's own average ER, or over-indexed in the top group.
    const topShare = b.topHits / b.ers.length;
    const isWinner = (avg != null && overallAvg != null && avg >= overallAvg) || topShare >= 0.5;
    hooks.push({
      key, label: rule.label, count: b.ers.length, avg_er: avg,
      is_winner: isWinner, template: rule.template,
      example: b.best?.opener ?? null,
    });
  }

  // Rank: winners first, then by avg ER, then by how often they're used.
  hooks.sort((a, b) => {
    if (a.is_winner !== b.is_winner) return a.is_winner ? -1 : 1;
    const ae = a.avg_er ?? 0, be = b.avg_er ?? 0;
    if (be !== ae) return be - ae;
    return b.count - a.count;
  });

  const top_hook = hooks.find((h) => h.is_winner) ?? hooks[0] ?? null;

  let headline: string | null = null;
  let tip: string | null = null;
  if (top_hook) {
    const lift = top_hook.avg_er != null && overallAvg != null && overallAvg > 0
      ? Math.round(((top_hook.avg_er - overallAvg) / overallAvg) * 100)
      : null;
    headline = `Your strongest opener is the ${top_hook.label.toLowerCase()}` +
      (lift != null && lift > 0 ? ` — those posts engage about ${lift}% above your average.` : ' — it shows up most in your best posts.');
    const winners = hooks.filter((h) => h.is_winner).slice(0, 3).map((h) => h.label.toLowerCase());
    tip = winners.length > 1
      ? `Lead more captions with a ${winners.slice(0, 2).join(' or a ')}, and skip the flat openers that bury the point.`
      : `Open with a ${top_hook.label.toLowerCase()} more often — the first line is what stops the scroll.`;
  }

  return {
    available: hooks.length > 0,
    sample_size: usable.length,
    overall_avg_er: overallAvg,
    top_hook,
    hooks: hooks.slice(0, 6),
    headline,
    tip,
  };
}
