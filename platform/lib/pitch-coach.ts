// ============================================================
// Pitch coach — a negotiation cheat-sheet that turns the dashboard's numbers
// into a "what to charge, and why" summary a creator can take into a brand
// conversation. Pure synthesis of signals computed elsewhere (EMV, peer
// benchmark, rate card, best format, audience quality, cadence) — no new data.
//
// The goal: give creators the CONFIDENCE and EVIDENCE to hold a rate. Every
// talking point cites a real number they can point to.
// ============================================================

import type { RateCard } from './media-kit';
import type { MediaValue } from './media-value';
import type { PeerBenchmark } from './peer-benchmark';
import type { AudienceQuality } from './audience-quality';
import type { ContentBreakdown } from './reel-forecast';

export interface PitchCoach {
  available: boolean;
  headline: string;                          // one-line positioning statement
  suggested_ask: { low: number; high: number; deliverable: string } | null;
  talking_points: string[];                  // evidence-backed selling points
  readiness: {
    score: number;                           // 0..100 "how pitch-ready are you"
    label: 'strong' | 'solid' | 'building';
    gaps: string[];                          // honest things to shore up first
  };
}

export interface PitchInput {
  followers: number | null;
  tier_label: string;                        // e.g. "micro"
  avg_er: number | null;                     // fraction
  media_value: MediaValue | null;
  benchmark: PeerBenchmark | null;
  audience_quality: AudienceQuality | null;
  content_breakdown: ContentBreakdown | null;
  rate_card: RateCard | null;
  posts_per_week: number | null;
}

const money = (v: number): string => '₹' + Math.round(v).toLocaleString('en-IN');
const asPct = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—';

const NICE_FORMAT: Record<string, string> = { reels: 'Reels', photos: 'photos', carousels: 'carousels' };
// Map the best content format to the matching rate-card line.
const FORMAT_RATE_LABEL: Record<string, string> = { reels: 'Reel', photos: 'Static post', carousels: 'Carousel' };

export function generatePitchCoach(input: PitchInput): PitchCoach {
  const { benchmark: bm, media_value: mv, audience_quality: aq, content_breakdown: cb, rate_card: rc } = input;

  const empty: PitchCoach = {
    available: false, headline: '', suggested_ask: null, talking_points: [],
    readiness: { score: 0, label: 'building', gaps: [] },
  };
  if (!input.followers || input.followers <= 0) return empty;

  // ---- Suggested ask: lead with the creator's best format ----------------
  let suggested_ask: PitchCoach['suggested_ask'] = null;
  const bestFormat = cb?.best_type ?? null;
  if (rc) {
    const rateLabel = bestFormat ? FORMAT_RATE_LABEL[bestFormat] : 'Reel';
    const item = rc.items.find((i) => i.label === rateLabel) ?? rc.items[0];
    if (item) suggested_ask = { low: item.low, high: item.high, deliverable: item.label };
  }

  // ---- Talking points (evidence-backed) ----------------------------------
  const points: string[] = [];

  // 1) Peer standing — the strongest lever when it's good.
  if (bm?.available && bm.percentile != null && (bm.verdict === 'top' || bm.verdict === 'above')) {
    points.push(
      bm.verdict === 'top'
        ? `You're in the top ${100 - bm.percentile}% of ${bm.cohort_label} for engagement — well above the median (${asPct(bm.cohort_median_er)}). That premium justifies rates above follower-count averages.`
        : `Your engagement beats most ${bm.cohort_label} (${bm.percentile}th percentile). Brands pay for engaged audiences, not just big ones.`,
    );
  } else if (input.avg_er != null && input.avg_er > 0) {
    points.push(`Your posts average ${asPct(input.avg_er)} engagement — lead with real interaction, not just reach.`);
  }

  // 2) EMV — a concrete ad-spend equivalent.
  if (mv?.available) {
    points.push(
      `Each post delivers roughly ${money(mv.per_post_mid)} in equivalent ad value` +
      (mv.monthly_mid != null ? ` — about ${money(mv.monthly_mid)}/month of earned media at your cadence.` : '.'),
    );
  }

  // 3) Best format — what to sell as the hero deliverable.
  if (bestFormat) {
    const stat = cb?.by_type.find((t) => t.type === bestFormat);
    if (stat?.avg_er != null) {
      points.push(`Offer ${NICE_FORMAT[bestFormat]} as your hero deliverable — they pull ${asPct(stat.avg_er)} for you, your strongest format.`);
    }
  }

  // 4) Audience authenticity — reassurance for brands vetting you.
  if (aq?.available && aq.score != null && aq.grade) {
    if (aq.score >= 70) {
      points.push(`Your audience-quality score is ${aq.score}/100 (${aq.grade}) — reassure brands the engagement is genuine.`);
    }
  }

  // 5) Consistency — reliability signals professionalism.
  if (input.posts_per_week != null && input.posts_per_week >= 3) {
    points.push(`You post ~${input.posts_per_week}×/week — dependable output brands can plan a campaign around.`);
  }

  // ---- Readiness score + honest gaps -------------------------------------
  let score = 40; // baseline for having a connected, analysable account
  const gaps: string[] = [];

  if (bm?.available && bm.percentile != null) {
    score += bm.percentile >= 60 ? 25 : bm.percentile >= 35 ? 12 : 0;
    if (bm.verdict === 'below') gaps.push('Engagement trails similar creators — lift it before pushing premium rates.');
  }
  if (aq?.available && aq.score != null) {
    score += aq.score >= 70 ? 15 : aq.score >= 55 ? 8 : 0;
    const concern = aq.signals.find((s) => s.status === 'concern');
    if (concern) gaps.push(`Shore up your ${concern.label.toLowerCase()} — brands vet this.`);
  } else {
    gaps.push('Not enough posts yet for a full audience-quality read — keep posting to strengthen your case.');
  }
  if (input.posts_per_week != null) {
    score += input.posts_per_week >= 3 ? 12 : input.posts_per_week >= 1.5 ? 6 : 0;
    if (input.posts_per_week < 1.5) gaps.push('Posting under ~1.5×/week reads as inactive — a steadier cadence strengthens pitches.');
  }
  if (mv?.available) score += 8;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const label: PitchCoach['readiness']['label'] = score >= 75 ? 'strong' : score >= 55 ? 'solid' : 'building';

  // ---- Headline ----------------------------------------------------------
  let headline: string;
  if (bm?.available && bm.verdict === 'top') {
    headline = `You're a standout ${input.tier_label} creator — pitch on engagement quality, not just follower count.`;
  } else if (bm?.available && bm.verdict === 'above') {
    headline = `You're an above-average ${input.tier_label} creator — you have room to ask for more than baseline rates.`;
  } else if (label === 'building') {
    headline = `You're building a pitchable profile — the fundamentals below are your starting evidence.`;
  } else {
    headline = `You're a solid ${input.tier_label} creator — here's the evidence to anchor your rate.`;
  }

  return {
    available: points.length > 0,
    headline,
    suggested_ask,
    talking_points: points.slice(0, 5),
    readiness: { score, label, gaps: gaps.slice(0, 3) },
  };
}
