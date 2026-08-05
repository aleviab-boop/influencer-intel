// ============================================================
// "Recommended focus" — turns the dashboard's computed signals into a small,
// prioritised list of plain-English actions. Purely rule-based and
// transparent: every recommendation traces back to a specific number the
// creator can see elsewhere on the page. No LLM, no guessing.
// ============================================================

import type { ReelForecast, ContentBreakdown } from './reel-forecast';
import type { AudienceQuality } from './audience-quality';
import type { ContentAnalysis } from './content-analysis';
import type { CaptionAnalysis } from './caption-analysis';

export interface Recommendation {
  id: string;
  kind: 'content' | 'timing' | 'growth' | 'money' | 'quality';
  title: string;
  body: string;
  priority: number; // higher = more important
}

export interface RecommendationInput {
  content_breakdown: ContentBreakdown;
  reel_forecast: ReelForecast;
  content_analysis: ContentAnalysis;
  audience_quality: AudienceQuality;
  caption_analysis?: CaptionAnalysis;
  posts_per_week: number | null;
  saves_shares_pct: number | null; // 0..100
}

const NICE_FORMAT: Record<string, string> = { reels: 'Reels', photos: 'photos', carousels: 'carousels' };
const asPct = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—';

export function generateRecommendations(input: RecommendationInput): Recommendation[] {
  const recs: Recommendation[] = [];
  const { content_breakdown: cb, reel_forecast: rf, content_analysis: ca, audience_quality: aq } = input;

  // 1) Reel momentum ------------------------------------------------------
  if (rf.trend === 'cooling' && rf.momentum_pct != null) {
    recs.push({
      id: 'reel-cooling', kind: 'content', priority: 9,
      title: 'Reel views are cooling off',
      body: `Recent reels are down ${Math.abs(rf.momentum_pct)}% vs earlier. Try a stronger hook in the first 2 seconds, a trending audio, or a fresh format to reset momentum.`,
    });
  } else if (rf.trend === 'rising' && rf.momentum_pct != null) {
    recs.push({
      id: 'reel-rising', kind: 'growth', priority: 4,
      title: 'Reel momentum is up',
      body: `Reels are up ${rf.momentum_pct}% recently — keep this cadence and lean into the styles that are working while the algorithm is favouring you.`,
    });
  }

  // 2) Best format --------------------------------------------------------
  if (cb.best_type) {
    const best = cb.by_type.find((t) => t.type === cb.best_type);
    const reels = cb.by_type.find((t) => t.type === 'reels');
    const reelShare = reels && reels.count > 0;
    if (best && best.avg_er != null) {
      // If reels win but the creator posts few of them, nudge the mix.
      if (cb.best_type === 'reels' && reelShare && reels!.count < 4) {
        recs.push({
          id: 'more-reels', kind: 'content', priority: 7,
          title: 'Post more reels',
          body: `Reels are your top format at ${asPct(reels!.avg_er)} engagement, but you've posted only ${reels!.count} recently. Shift more of your mix to reels.`,
        });
      } else if (cb.best_type !== 'reels') {
        recs.push({
          id: 'lean-format', kind: 'content', priority: 6,
          title: `${NICE_FORMAT[cb.best_type]} are outperforming for you`,
          body: `Your ${NICE_FORMAT[cb.best_type]} pull ${asPct(best.avg_er)} engagement — above your other formats. Make more of them, not just reels.`,
        });
      }
    }
  }

  // 3) Sponsored vs organic ----------------------------------------------
  if (ca.sponsored.count > 0 && ca.sponsored_er_delta_pct != null && ca.sponsored_er_delta_pct > 15) {
    recs.push({
      id: 'sponsored-drop', kind: 'money', priority: 8,
      title: 'Branded posts are dragging engagement',
      body: `Sponsored posts get ${ca.sponsored_er_delta_pct}% less engagement than your organic content. Integrate products into your usual style and add a genuine POV so deals don't cost you reach — and so brands see stronger results.`,
    });
  }

  // 4) Posting cadence ----------------------------------------------------
  if (input.posts_per_week != null && input.posts_per_week < 2) {
    recs.push({
      id: 'cadence', kind: 'growth', priority: 6,
      title: 'Post more consistently',
      body: `You're posting ~${input.posts_per_week}×/week. Lifting to 3–4×/week keeps you in front of your audience and tends to accelerate follower growth.`,
    });
  }

  // 5) Audience-quality concerns -----------------------------------------
  const concern = aq.available ? aq.signals.find((s) => s.status === 'concern') : undefined;
  if (concern) {
    const tip = concern.key === 'comments'
      ? 'End captions with a question and reply to comments quickly to spark conversation.'
      : concern.key === 'engagement'
        ? 'Focus on save-worthy, shareable content to lift engagement back toward your tier’s norm.'
        : 'Keep an eye on this — sudden shifts can spook brands vetting your account.';
    recs.push({
      id: `quality-${concern.key}`, kind: 'quality', priority: 8,
      title: `Watch your ${concern.label.toLowerCase()}`,
      body: `${concern.detail} ${tip}`,
    });
  }

  // 6) Saves & shares -----------------------------------------------------
  if (input.saves_shares_pct != null && input.saves_shares_pct < 8) {
    recs.push({
      id: 'saves-shares', kind: 'content', priority: 5,
      title: 'Make more save-worthy content',
      body: `Only ${input.saves_shares_pct}% of your interactions are saves & shares. Tips, how-tos and carousels people want to keep or send to a friend boost distribution the algorithm rewards.`,
    });
  }

  // 7) Caption / CTA habit ------------------------------------------------
  const cap = input.caption_analysis;
  if (cap?.available) {
    const cta = cap.cta_split;
    // A real, positive CTA lift the creator is under-using is the best nudge.
    if (cta?.lift_pct != null && cta.lift_pct >= 12 && cap.cta_usage_pct != null && cap.cta_usage_pct < 50) {
      recs.push({
        id: 'caption-cta', kind: 'content', priority: 6,
        title: 'Ask your audience to act',
        body: `Captions with a question or call-to-action earn you ${cta.lift_pct}% more engagement, yet only ${cap.cta_usage_pct}% of your posts have one. Add a simple prompt — a question, "save this", or "tag a friend".`,
      });
    } else if (cap.emoji_split?.lift_pct != null && cap.emoji_split.lift_pct >= 12) {
      recs.push({
        id: 'caption-emoji', kind: 'content', priority: 3,
        title: 'Emojis are working for you',
        body: `Your posts with emojis pull ${cap.emoji_split.lift_pct}% more engagement. Keep adding personality — but don't overdo it on branded posts.`,
      });
    }
  }

  // 8) Winning hashtag ----------------------------------------------------
  const topTag = ca.hashtags[0];
  if (topTag && topTag.avg_er != null) {
    recs.push({
      id: 'top-hashtag', kind: 'content', priority: 3,
      title: `${topTag.tag} is working for you`,
      body: `Posts using ${topTag.tag} average ${asPct(topTag.avg_er)} engagement — your highest. Keep using relevant tags like it (but rotate to avoid staleness).`,
    });
  }

  return recs.sort((a, b) => b.priority - a.priority).slice(0, 5);
}
