// ============================================================
// Content playbook — "your next 3 posts". Where the recommendations card is
// DIAGNOSTIC (what's wrong / what's working), this is PRESCRIPTIVE: three
// ready-to-shoot post briefs that combine the creator's best format, best
// posting window, winning hashtag and caption style into concrete plans.
//
// Pure synthesis of signals computed elsewhere — no new data, no LLM. Each
// brief cites the evidence behind it so the creator trusts the plan.
// ============================================================

import type { ContentBreakdown, ReelForecast } from './reel-forecast';
import type { ContentAnalysis } from './content-analysis';
import type { CaptionAnalysis } from './caption-analysis';
import type { PostingTimeAnalysis } from './posting-time';

export interface PostBrief {
  n: number;
  format: string;                 // "Reel" | "Carousel" | "Photo"
  window: string | null;          // "Friday evening · 6–10pm IST"
  hook: string;                   // the angle / creative direction
  caption_tip: string;            // how to write the caption
  hashtag: string | null;         // a tag to include
  why: string;                    // one-line evidence
}

export interface ContentPlaybook {
  available: boolean;
  briefs: PostBrief[];
}

export interface PlaybookInput {
  content_breakdown: ContentBreakdown | null;
  reel_forecast: ReelForecast | null;
  content_analysis: ContentAnalysis | null;
  caption_analysis: CaptionAnalysis | null;
  posting_time: PostingTimeAnalysis | null;
}

const FORMAT_LABEL: Record<string, string> = { reels: 'Reel', photos: 'Photo', carousels: 'Carousel' };
const asPct = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—';

function windowText(pt: PostingTimeAnalysis | null): string | null {
  if (!pt?.available) return null;
  const day = pt.best_day?.label;
  const part = pt.best_part ? `${pt.best_part.label.toLowerCase()} · ${pt.best_part.range} IST` : null;
  if (day && part) return `${day} ${part}`;
  if (part) return part;
  if (day) return day;
  return null;
}

// A caption tip that reflects what actually works for this creator.
function captionTip(ca: CaptionAnalysis | null): string {
  if (ca?.available) {
    if (ca.cta_split?.lift_pct != null && ca.cta_split.lift_pct >= 10) {
      return `End with a question or clear CTA — those earn you +${ca.cta_split.lift_pct}% engagement.`;
    }
    if (ca.best_length === 'short') return 'Keep the caption short and punchy — that length lands best for you.';
    if (ca.best_length === 'long') return 'Write a longer, story-style caption — your audience reads them.';
    if (ca.emoji_split?.lift_pct != null && ca.emoji_split.lift_pct >= 10) {
      return `Add a few emojis for personality — they lift your engagement ${ca.emoji_split.lift_pct}%.`;
    }
  }
  return 'Open with a strong first line and end by inviting a reply.';
}

export function generateContentPlaybook(input: PlaybookInput): ContentPlaybook {
  const { content_breakdown: cb, reel_forecast: rf, content_analysis: ca, caption_analysis: cap, posting_time: pt } = input;

  const window = windowText(pt);
  const tip = captionTip(cap);
  const topTag = ca?.hashtags?.[0]?.tag ?? null;

  const bestType = cb?.best_type ?? null;
  const bestStat = bestType ? cb?.by_type.find((t) => t.type === bestType) ?? null : null;

  const briefs: PostBrief[] = [];

  // ---- Brief 1: double down on the best format --------------------------
  if (bestStat && bestStat.avg_er != null) {
    briefs.push({
      n: 1,
      format: FORMAT_LABEL[bestType!] ?? 'Post',
      window,
      hook: bestType === 'reels'
        ? 'Lead with a scroll-stopping first 2 seconds — a bold claim, a transformation, or a question your audience feels.'
        : bestType === 'carousels'
          ? 'Open on slide 1 with the payoff/promise, then deliver it step-by-step so people swipe to the end.'
          : 'Frame one striking, high-contrast shot with a clear subject — make the thumbnail earn the tap.',
      caption_tip: tip,
      hashtag: topTag,
      why: `${FORMAT_LABEL[bestType!]}s are your top format at ${asPct(bestStat.avg_er)} engagement.`,
    });
  }

  // ---- Brief 2: a save-worthy carousel (distribution the algo rewards) ---
  briefs.push({
    n: briefs.length + 1,
    format: 'Carousel',
    window,
    hook: 'Make a “save this” carousel — a tips list, how-to, or myth-vs-fact your audience will want to keep or send to a friend.',
    caption_tip: 'Number the slides and tell people to save it for later — saves and shares expand your reach.',
    hashtag: topTag,
    why: 'Saves & shares are the interactions Instagram weighs most for distribution.',
  });

  // ---- Brief 3: momentum-aware experiment -------------------------------
  const reelCooling = rf?.trend === 'cooling';
  briefs.push({
    n: briefs.length + 1,
    format: 'Reel',
    window,
    hook: reelCooling
      ? 'Reset your reel momentum: try a fresh format with trending audio and a harder hook in the first second.'
      : 'Experiment with a new reel angle — a trend, a behind-the-scenes, or a fast-paced list — to find your next repeatable win.',
    caption_tip: 'Use trending audio and keep on-screen text readable in the first frame.',
    hashtag: null,
    why: reelCooling
      ? `Your recent reels are cooling${rf?.momentum_pct != null ? ` (${rf.momentum_pct}%)` : ''} — a fresh format can reset the algorithm.`
      : 'Regular experiments keep the algorithm feeding you new audiences.',
  });

  return { available: briefs.length > 0, briefs: briefs.slice(0, 3) };
}
