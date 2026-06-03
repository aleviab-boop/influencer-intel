// ============================================================
// Credibility scorer — real signal version.
//
// Components (weighted):
//   - follower-to-following ratio        25%
//   - posts:follower ratio sanity        10%
//   - vision profile_completeness_score  10%
//   - vision visual_quality_score        15%
//   - vision engagement_quality_signal   20%
//   - verified bonus                     +8 absolute
//   - brand_safety bio scan              modifier (penalises red flags)
//
// Score 0-100, banded green ≥80, amber 55-79, red <55.
// ============================================================

import type {
  CredibilityBadge,
  CredibilityData,
  CreatorRawMetadata,
  ExtensionExtractionResult,
  ScrapeJob,
  VisionEnrichment,
} from '@influencer-intel/shared/types';
import { getBolticClient } from '@influencer-intel/shared/db';

const ENG_QUALITY_MAP: Record<string, number> = {
  high: 90,
  medium: 65,
  low: 35,
  unknown: 50,
};

export function computeCredibilityFromExtraction(
  extraction: ExtensionExtractionResult,
  vision?: VisionEnrichment | null,
  postSignals?: { engagement_rate?: number | null; posts_per_week?: number | null; last_post_at?: string | null } | null,
): CredibilityData {
  const followers = extraction.follower_count ?? 0;
  const following = extraction.following_count ?? 0;
  const posts = extraction.posts_count ?? 0;
  const isVerified = extraction.is_verified ?? false;
  const flags: string[] = [];

  // ---------------- 1. Follower:following ratio ----------------
  // Healthy creators: followers > following × 2 (lots more followers)
  // Suspicious: following > followers (mass-follow bots / new accounts)
  let followRatioScore: number | null = null;
  if (followers > 0 && following > 0) {
    const ratio = followers / following;
    if (ratio >= 50) followRatioScore = 95;        // mega creator profile
    else if (ratio >= 10) followRatioScore = 85;   // healthy macro
    else if (ratio >= 3) followRatioScore = 70;    // healthy micro
    else if (ratio >= 1) followRatioScore = 50;    // borderline
    else if (ratio >= 0.5) {
      followRatioScore = 30;                        // following > followers
      flags.push('high_following_ratio');
    } else {
      followRatioScore = 15;                        // mass-follow pattern
      flags.push('mass_follow_pattern');
    }
  }

  // ---------------- 2. Posts:followers sanity ----------------
  // Real creators: have at least some posts; ratio should be reasonable
  let postRatioScore: number | null = null;
  if (followers > 0 && posts > 0) {
    if (posts < 5) {
      postRatioScore = 25;                          // suspiciously few posts
      flags.push('few_posts');
    } else if (posts > followers * 2) {
      postRatioScore = 35;                          // way more posts than followers (shop / spam)
      flags.push('post_spam_pattern');
    } else if (posts > followers / 2) {
      postRatioScore = 55;                          // borderline (very high posting cadence)
    } else {
      postRatioScore = 80;                          // healthy
    }
  } else if (posts === 0) {
    postRatioScore = 20;
    flags.push('zero_posts');
  }

  // ---------------- 3. Vision-derived scores ----------------
  const visionCompleteness =
    typeof vision?.profile_completeness_score === 'number'
      ? Math.max(0, Math.min(100, vision.profile_completeness_score))
      : null;

  const visionQuality =
    typeof vision?.visual_quality_score === 'number'
      ? Math.max(0, Math.min(100, vision.visual_quality_score))
      : null;

  // Real engagement rate beats vision's qualitative high/medium/low.
  // IG benchmarks: <1% poor, 1-3% good, 3-6% great, 6%+ exceptional.
  let realEngagementScore: number | null = null;
  const er = postSignals?.engagement_rate;
  if (typeof er === 'number') {
    if (er >= 6) realEngagementScore = 95;
    else if (er >= 3) realEngagementScore = 85;
    else if (er >= 1.5) realEngagementScore = 70;
    else if (er >= 0.5) realEngagementScore = 50;
    else realEngagementScore = 30;
    if (er < 0.5) flags.push('low_engagement_rate');
  }

  // Fallback to vision's qualitative signal when real ER unavailable.
  const visionEngagement =
    vision?.engagement_quality_signal && typeof vision.engagement_quality_signal === 'string'
      ? ENG_QUALITY_MAP[vision.engagement_quality_signal] ?? 50
      : null;
  // Prefer realEngagementScore when present
  const engagementScore = realEngagementScore ?? visionEngagement;

  // Posting cadence — too few posts/week suggests inactive; too many can be spam
  let cadenceScore: number | null = null;
  const ppw = postSignals?.posts_per_week;
  if (typeof ppw === 'number') {
    if (ppw < 0.25) {
      cadenceScore = 35; // less than 1 post/month
      flags.push('inactive');
    } else if (ppw < 1) cadenceScore = 60;
    else if (ppw <= 7) cadenceScore = 90; // sweet spot 1-7 per week
    else if (ppw <= 14) cadenceScore = 75;
    else { cadenceScore = 50; flags.push('high_post_cadence'); }
  }
  // Stale account check
  if (postSignals?.last_post_at) {
    const ageDays = (Date.now() - new Date(postSignals.last_post_at).getTime()) / (24 * 3600 * 1000);
    if (ageDays > 60) flags.push('stale_60d_no_post');
  }

  // ---------------- 4. Brand safety from bio ----------------
  const bioSafety = computeBrandSafetyFromBio(extraction.bio ?? '', extraction.display_name ?? '');
  if (bioSafety < 60) flags.push('brand_safety_concern');

  // ---------------- 5. Weighted composite ----------------
  // Weights normalize against the components actually present (so
  // un-vision'd creators still get a useful score from follow ratios).
  const components: Array<{ name: string; score: number; weight: number }> = [];
  if (followRatioScore !== null) components.push({ name: 'follow_ratio', score: followRatioScore, weight: 20 });
  if (postRatioScore !== null) components.push({ name: 'post_ratio', score: postRatioScore, weight: 8 });
  if (visionCompleteness !== null) components.push({ name: 'profile_completeness', score: visionCompleteness, weight: 8 });
  if (visionQuality !== null) components.push({ name: 'visual_quality', score: visionQuality, weight: 12 });
  if (engagementScore !== null) {
    components.push({
      name: realEngagementScore !== null ? 'real_engagement_rate' : 'engagement_quality_signal',
      score: engagementScore,
      weight: realEngagementScore !== null ? 30 : 18,
    });
  }
  if (cadenceScore !== null) components.push({ name: 'posting_cadence', score: cadenceScore, weight: 12 });
  components.push({ name: 'brand_safety', score: bioSafety, weight: 5 });

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  let overall =
    totalWeight === 0
      ? 50
      : Math.round(components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);

  // Verified bonus
  if (isVerified) overall = Math.min(100, overall + 8);

  // Penalise heavily on bio-safety red flag
  if (bioSafety <= 30) overall = Math.min(overall, 40);

  // Posts < 5 always caps to 50
  if (posts > 0 && posts < 5) overall = Math.min(overall, 55);

  if (components.length < 3) flags.push('limited_signal');

  const badge: CredibilityBadge =
    overall >= 80 ? 'green' : overall >= 55 ? 'amber' : 'red';

  return {
    overall_score: overall,
    badge,
    signals: {
      follower_engagement_ratio: followRatioScore,
      engagement_velocity: postRatioScore,
      comment_to_like_ratio: null,
      follower_growth_pattern: null,
      audience_geo_authenticity: null,
      brand_safety: bioSafety,
      comment_text_quality: visionEngagement,
      audience_account_age: null,
      story_engagement_parity: null,
      hashtag_engagement_match: null,
      // Extra signals not in the original schema; consumed by UI as raw fields
      ...({
        profile_completeness: visionCompleteness,
        visual_quality: visionQuality,
        verified_bonus: isVerified ? 8 : 0,
      } as Record<string, number | null>),
    },
    flags,
    computed_at: new Date().toISOString(),
  };
}

function computeBrandSafetyFromBio(bio: string, displayName: string): number {
  const text = `${bio} ${displayName}`.toLowerCase();
  const redFlags = ['cbd', 'cannabis', 'casino', 'gambling', 'porn', 'nsfw', 'escort', 'crypto pump', 'forex signal'];
  for (const f of redFlags) if (text.includes(f)) return 25;
  const amberFlags = ['political', 'protest', 'controversy'];
  for (const f of amberFlags) if (text.includes(f)) return 60;
  return 90;
}

/** Recompute credibility from existing DB row (no fresh extraction). */
export async function handleCredibilityRecompute(job: ScrapeJob): Promise<void> {
  if (!job.creator_id) return;
  const db = getBolticClient();
  const creator = await db.findById<{
    bio: string | null;
    display_name: string | null;
    follower_count: number | null;
    following_count: number | null;
    posts_count: number | null;
    is_verified: boolean | null;
    raw_metadata: CreatorRawMetadata | null;
  }>('creators', job.creator_id);
  if (!creator) return;

  const fakeExtraction: ExtensionExtractionResult = {
    handle: job.target_handle,
    platform_user_id: null,
    display_name: creator.display_name,
    bio: creator.bio,
    profile_photo_url: null,
    is_verified: !!creator.is_verified,
    follower_count: creator.follower_count,
    following_count: creator.following_count,
    posts_count: creator.posts_count,
    recent_posts: [],
    hashtags_seen: [],
    extracted_at: new Date().toISOString(),
  };
  const vision = (creator.raw_metadata?.vision as VisionEnrichment | undefined) ?? null;
  const credibility = computeCredibilityFromExtraction(fakeExtraction, vision);

  await db.update('creators', { id: job.creator_id }, { credibility });
}
