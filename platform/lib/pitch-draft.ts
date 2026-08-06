// ============================================================
// Pitch draft — a copy-ready outreach message built from the creator's real
// numbers. The pitch coach tells them WHAT to say; this hands them the actual
// email/DM to paste, customise (a couple of {placeholders}), and send.
//
// Rule-based templating, no LLM: every figure is one the creator can defend,
// pulled from signals already computed. Placeholders are kept obvious so it's
// clear what to personalise before sending.
// ============================================================

import type { MediaValue } from './media-value';
import type { PeerBenchmark } from './peer-benchmark';
import type { ContentBreakdown } from './reel-forecast';

export interface PitchDraft {
  available: boolean;
  subject: string;
  body: string;                 // newline-delimited; UI renders as-is
}

export interface PitchDraftInput {
  name: string | null;
  handle: string | null;
  tier_label: string;           // e.g. "micro"
  niche: string | null;
  followers: number | null;
  avg_er: number | null;        // fraction
  media_value: MediaValue | null;
  benchmark: PeerBenchmark | null;
  content_breakdown: ContentBreakdown | null;
  posts_per_week: number | null;
}

const money = (v: number): string => '₹' + Math.round(v).toLocaleString('en-IN');
const compact = (v: number): string =>
  v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v));
const asPct = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : null as unknown as string;

const NICE_FORMAT: Record<string, string> = { reels: 'Reels', photos: 'photos', carousels: 'carousels' };

export function generatePitchDraft(input: PitchDraftInput): PitchDraft {
  const { benchmark: bm, media_value: mv, content_breakdown: cb } = input;
  const empty: PitchDraft = { available: false, subject: '', body: '' };
  if (!input.followers || input.followers <= 0 || input.avg_er == null) return empty;

  const name = input.name?.trim() || (input.handle ? `@${input.handle}` : 'me');
  const handle = input.handle ? `@${input.handle}` : '';
  const nicheBit = input.niche ? ` ${input.niche}` : '';
  const er = asPct(input.avg_er);
  const followers = compact(input.followers);

  const subject = `Collaboration — ${handle || name} (${followers} followers,${nicheBit ? nicheBit : ''} ${er} engagement)`.replace(/\s+/g, ' ').trim();

  // Opening line, strengthened by peer standing when it's good.
  let standing = '';
  if (bm?.available && bm.percentile != null && (bm.verdict === 'top' || bm.verdict === 'above')) {
    standing = bm.verdict === 'top'
      ? ` — that puts me in the top ${100 - bm.percentile}% of ${bm.cohort_label} for engagement`
      : ` — above most ${bm.cohort_label} for engagement`;
  }

  // Bullet highlights.
  const bullets: string[] = [];
  bullets.push(`• ${followers} followers at a ${er} average engagement rate${bm?.available && bm.percentile != null ? ` (${bm.percentile}th percentile among similar creators)` : ''}`);
  if (mv?.available) {
    bullets.push(`• ~${money(mv.per_post_mid)} in equivalent media value per post${mv.monthly_mid != null ? `, ~${money(mv.monthly_mid)}/month at my current cadence` : ''}`);
  }
  if (cb?.best_type) {
    const stat = cb.by_type.find((t) => t.type === cb.best_type);
    if (stat?.avg_er != null) bullets.push(`• ${NICE_FORMAT[cb.best_type]} are my strongest format at ${asPct(stat.avg_er)} engagement`);
  }
  if (input.posts_per_week != null && input.posts_per_week >= 2) {
    bullets.push(`• Consistent posting at ~${input.posts_per_week}×/week`);
  }

  const body = [
    `Hi {Brand} team,`,
    ``,
    `I'm ${name}${handle && name !== handle ? ` (${handle})` : ''}, a${nicheBit} content creator with ${followers} engaged followers and a ${er} average engagement rate${standing}.`,
    ``,
    `I love what {Brand} is doing with {product/campaign}, and I think my audience would genuinely connect with it. Here's a quick snapshot of what I bring:`,
    ``,
    ...bullets,
    ``,
    `I'd love to explore a collaboration — a dedicated ${cb?.best_type && NICE_FORMAT[cb.best_type] ? NICE_FORMAT[cb.best_type]!.replace(/s$/, '') : 'post'} or a small package, whatever fits your goals. I can share my full media kit and rates on request.`,
    ``,
    `Would you be open to a quick chat?`,
    ``,
    `Best,`,
    `${name}`,
  ].join('\n');

  return { available: bullets.length > 0, subject, body };
}
