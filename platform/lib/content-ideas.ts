// ============================================================
// Content ideas — turns the playbook's "make a Reel" into a shortlist of
// specific, ready-to-shoot concepts. Where the playbook gives one brief per
// slot, this spins the creator's winning format + topic through a set of
// proven angle archetypes (how-to, myth-bust, listicle, mistakes, hot-take…)
// so they never stare at a blank camera.
//
// Rule-based templating, no LLM: each idea plugs the creator's real topic
// (their niche or top-performing hashtag) into an archetype hook, and every
// idea carries a format-appropriate execution note. Deterministic — the same
// signals yield the same shortlist.
// ============================================================

export type FormatType = 'reels' | 'photos' | 'carousels';

export interface ContentIdea {
  n: number;
  format: string;          // "Reel" | "Carousel" | "Photo"
  angle: string;           // archetype label, e.g. "How-to"
  hook: string;            // the opening line / concept to lead with
  outline: string;         // one-line execution note
  hashtag: string | null;  // a tag to include
}

export interface ContentIdeas {
  available: boolean;
  topic: string | null;    // the subject the ideas are built around
  ideas: ContentIdea[];
}

export interface ContentIdeasInput {
  best_type: FormatType | null;
  niche: string | null;
  top_hashtag: string | null;                       // e.g. "#skincare"
  caption_best_length?: 'short' | 'medium' | 'long' | null;
}

const FORMAT_LABEL: Record<FormatType, string> = { reels: 'Reel', photos: 'Photo', carousels: 'Carousel' };

// Execution notes tuned to each format's mechanics.
const OUTLINE: Record<FormatType, string> = {
  reels: 'Hook in the first 2 seconds, trending audio, on-screen text readable in frame one.',
  carousels: 'Slide 1 = the promise, deliver it slide-by-slide, final slide = a clear “save this”.',
  photos: 'One striking, high-contrast frame; carry the story and the payoff in the caption.',
};

// Angle archetypes. `hook(topic)` builds the opening; `formats` lists which
// content types the angle plays best in. Ordered roughly by broad appeal.
const ARCHETYPES: { angle: string; formats: FormatType[]; hook: (t: string) => string }[] = [
  { angle: 'How-to', formats: ['reels', 'carousels'], hook: (t) => `3 simple steps to ${t} — even if you're starting from scratch.` },
  { angle: 'Myth vs fact', formats: ['reels', 'carousels'], hook: (t) => `The biggest myth about ${t} — and what actually works instead.` },
  { angle: 'Listicle', formats: ['carousels', 'reels'], hook: (t) => `5 ${t} tips I wish someone told me earlier.` },
  { angle: 'Mistakes', formats: ['reels', 'carousels'], hook: (t) => `3 ${t} mistakes quietly costing you — and the quick fix for each.` },
  { angle: 'Hot take', formats: ['reels'], hook: (t) => `Unpopular opinion: most ${t} advice is wrong. Here's why.` },
  { angle: 'Transformation', formats: ['reels', 'photos'], hook: (t) => `The before & after of my ${t} — what changed and how.` },
  { angle: 'Behind the scenes', formats: ['photos', 'reels'], hook: (t) => `A real, unfiltered look at ${t} that nobody shows you.` },
  { angle: 'Story', formats: ['photos', 'reels'], hook: (t) => `The moment ${t} finally clicked for me — and the lesson in it.` },
  { angle: 'Comparison', formats: ['carousels', 'reels'], hook: (t) => `${cap(t)}: what I'd do differently now vs when I started.` },
];

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

// Derive a human topic from the niche, else the top hashtag, else a safe generic.
function deriveTopic(input: ContentIdeasInput): string | null {
  if (input.niche && input.niche.trim()) return input.niche.trim().toLowerCase();
  if (input.top_hashtag) {
    const t = input.top_hashtag.replace(/^#/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    if (t) return t.toLowerCase();
  }
  return null;
}

export function generateContentIdeas(input: ContentIdeasInput): ContentIdeas {
  const empty: ContentIdeas = { available: false, topic: null, ideas: [] };
  const format = input.best_type ?? 'reels';
  const topicRaw = deriveTopic(input);
  const topic = topicRaw ?? 'your niche';

  // Prefer archetypes that suit the creator's winning format, then backfill
  // with the rest so we always reach a full shortlist.
  const preferred = ARCHETYPES.filter((a) => a.formats.includes(format));
  const rest = ARCHETYPES.filter((a) => !a.formats.includes(format));
  const ordered = [...preferred, ...rest];

  const ideas: ContentIdea[] = ordered.slice(0, 5).map((a, i) => {
    // Give each idea the format the archetype prefers (its first listed),
    // biased to the creator's best format when the archetype supports it.
    const fmt: FormatType = a.formats.includes(format) ? format : a.formats[0]!;
    return {
      n: i + 1,
      format: FORMAT_LABEL[fmt],
      angle: a.angle,
      hook: a.hook(topic),
      outline: OUTLINE[fmt],
      hashtag: input.top_hashtag ?? null,
    };
  });

  if (ideas.length === 0) return empty;
  return { available: true, topic: topicRaw, ideas };
}
