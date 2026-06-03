import { getBolticClient } from '@influencer-intel/shared/db';
import type {
  ConnectedAccount, CreatorInsights, PostInsight,
  PerformanceBucket, InsightConfidence, Creator,
} from '@influencer-intel/shared/types';

export async function computeCreatorInsights(creatorId: string): Promise<CreatorInsights | null> {
  const db = getBolticClient();

  const accounts = await db.query<ConnectedAccount>(
    `SELECT * FROM connected_accounts WHERE creator_id = $1 AND connection_status = 'active' LIMIT 1`,
    [creatorId],
  );
  if (accounts.length === 0) return null;
  const account = accounts[0]!;

  const posts = await db.query<PostInsight>(
    `SELECT * FROM post_insights WHERE creator_id = $1 AND engagement_rate IS NOT NULL ORDER BY posted_at DESC`,
    [creatorId],
  );
  if (posts.length === 0) return null;

  const now = Date.now();
  const posts30d = posts.filter((p) => new Date(p.posted_at).getTime() > now - 30 * 86400000);
  const posts90d = posts.filter((p) => new Date(p.posted_at).getTime() > now - 90 * 86400000);

  const rolling_er_30d = posts30d.length > 0 ? median(posts30d.map((p) => p.engagement_rate!)) : null;
  const rolling_er_90d = posts90d.length > 0 ? median(posts90d.map((p) => p.engagement_rate!)) : null;

  const breakout_threshold = rolling_er_30d != null ? rolling_er_30d * 2.0 : null;
  const breakout_rate = breakout_threshold != null && posts90d.length > 0
    ? posts90d.filter((p) => p.engagement_rate! > breakout_threshold).length / posts90d.length
    : null;

  const ers90d = posts90d.map((p) => p.engagement_rate!);
  const mean90d = ers90d.length > 0 ? ers90d.reduce((s, v) => s + v, 0) / ers90d.length : 0;
  const std90d = ers90d.length > 1
    ? Math.sqrt(ers90d.reduce((s, v) => s + (v - mean90d) ** 2, 0) / (ers90d.length - 1))
    : 0;
  const er_coefficient_of_variation = mean90d > 0 ? std90d / mean90d : null;
  const consistency_score = er_coefficient_of_variation != null ? Math.max(0, 1 - er_coefficient_of_variation) : null;

  const timestamps = posts.map((p) => new Date(p.posted_at).getTime()).sort((a, b) => b - a);
  let posts_per_week: number | null = null;
  let avg_days_between_posts: number | null = null;
  if (timestamps.length >= 2) {
    const spanMs = timestamps[0]! - timestamps[timestamps.length - 1]!;
    const weeks = spanMs / (7 * 86400000);
    if (weeks > 0) posts_per_week = Math.round((timestamps.length / weeks) * 10) / 10;
    const gaps: number[] = [];
    for (let i = 0; i < timestamps.length - 1; i++) gaps.push((timestamps[i]! - timestamps[i + 1]!) / 86400000);
    avg_days_between_posts = Math.round((gaps.reduce((s, v) => s + v, 0) / gaps.length) * 10) / 10;
  }

  const creator = await db.findById<Creator>('creators', creatorId);
  const demographics = creator?.audience_demographics;
  let audience_quality_score: number | null = null;
  let audience_demographics_parsed = null;
  if (demographics && demographics.source === 'verified_oauth') {
    const indiaFactor = (demographics.country_india_pct ?? 0) / 100;
    const cityFactor = demographics.top_cities.length > 0 ? Math.min(1, demographics.top_cities.length / 5) : 0.5;
    audience_quality_score = Math.round((indiaFactor * 0.5 + cityFactor * 0.3 + 0.2) * 100) / 100;
    audience_demographics_parsed = {
      gender: { male_pct: demographics.gender.male_pct ?? 0, female_pct: demographics.gender.female_pct ?? 0 },
      top_age_band: '25_34',
      top_cities: demographics.top_cities.slice(0, 5),
      top_countries: [] as Array<{ country: string; pct: number }>,
    };
  }

  const sortedByEr = [...posts].sort((a, b) => (b.engagement_rate ?? 0) - (a.engagement_rate ?? 0));
  const top_posts = sortedByEr.slice(0, 5).map((p) => ({
    ig_shortcode: p.ig_shortcode, er: p.engagement_rate!,
    bucket: (p.performance_bucket ?? 'average') as PerformanceBucket,
  }));
  const worst_posts = sortedByEr.slice(-5).reverse().map((p) => ({
    ig_shortcode: p.ig_shortcode, er: p.engagement_rate!,
    bucket: (p.performance_bucket ?? 'average') as PerformanceBucket,
  }));

  const hourCounts = new Map<number, { count: number; totalEr: number }>();
  const dayCounts = new Map<number, { count: number; totalEr: number }>();
  for (const p of posts) {
    const d = new Date(p.posted_at);
    const hour = d.getUTCHours();
    const day = d.getUTCDay();
    const h = hourCounts.get(hour) ?? { count: 0, totalEr: 0 };
    h.count++; h.totalEr += p.engagement_rate ?? 0;
    hourCounts.set(hour, h);
    const dv = dayCounts.get(day) ?? { count: 0, totalEr: 0 };
    dv.count++; dv.totalEr += p.engagement_rate ?? 0;
    dayCounts.set(day, dv);
  }
  const best_posting_hours = [...hourCounts.entries()]
    .sort(([, a], [, b]) => (b.totalEr / b.count) - (a.totalEr / a.count))
    .slice(0, 3).map(([h]) => h);
  const best_posting_days = [...dayCounts.entries()]
    .sort(([, a], [, b]) => (b.totalEr / b.count) - (a.totalEr / a.count))
    .slice(0, 3).map(([d]) => d);

  let confidence: InsightConfidence = 'very_low';
  if (posts.length >= 30) confidence = 'high';
  else if (posts.length >= 15) confidence = 'medium';
  else if (posts.length >= 5) confidence = 'low';

  return {
    creator_id: creatorId, connected_account_id: account.id,
    rolling_er_30d, rolling_er_90d, breakout_rate, breakout_threshold,
    consistency_score, er_coefficient_of_variation,
    follower_growth_30d: null, follower_growth_90d: null,
    posts_per_week, avg_days_between_posts,
    audience_quality_score, audience_demographics: audience_demographics_parsed,
    top_posts, worst_posts, best_posting_hours, best_posting_days,
    computed_at: new Date().toISOString(), confidence,
  };
}

export interface ScrapedInsights {
  source: 'scraped';
  creator_id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number;
  following_count: number | null;
  posts_count: number | null;
  engagement_rate: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_views: number | null;
  primary_category: string | null;
  audience_demographics: Creator['audience_demographics'] | null;
  credibility: Creator['credibility'] | null;
  time_series: Array<{
    post_id: string;
    post_url: string;
    post_type: string | null;
    caption: string | null;
    posted_at: string | null;
    like_count: number | null;
    comment_count: number | null;
    view_count: number | null;
    engagement_rate: number | null;
    thumbnail_url: string | null;
  }>;
  posting_frequency: {
    avg_days_between_posts: number | null;
    posts_per_week: number | null;
  };
  engagement_trend: 'rising' | 'stable' | 'declining' | 'insufficient_data';
  confidence: InsightConfidence;
  brand_work: {
    brand_mentions: string[];
    has_paid_partnership: boolean;
    has_collab_tag: boolean;
    content_themes: string[];
    sponsored_posts: Array<{
      post_id: string;
      post_url: string;
      caption: string | null;
      posted_at: string | null;
      like_count: number | null;
      comment_count: number | null;
      view_count: number | null;
      detected_brands: string[];
      is_sponsored: boolean;
    }>;
  };
}

export async function computeScrapedInsights(creatorId: string): Promise<ScrapedInsights | null> {
  const db = getBolticClient();
  const creator = await db.findById<Creator>('creators', creatorId);
  if (!creator) return null;

  const recentPosts = (creator.recent_posts ?? []) as Creator['recent_posts'];
  const followerCount = Number(creator.follower_count) || 0;

  // Fallback: when recent_posts is empty, use raw_metadata.geo.posts (scraper output)
  interface GeoPost {
    code: string;
    timestamp: string;
    likes: number | null;
    comments: number | null;
    views: number | null;
    caption_excerpt: string | null;
    location: string | null;
    media_type: string | null;
  }
  const geoPosts = (
    (creator.raw_metadata as unknown as Record<string, unknown>)?.geo as Record<string, unknown>
  )?.posts as GeoPost[] | undefined;

  const useGeoPosts = (!recentPosts || recentPosts.length === 0) && geoPosts && geoPosts.length > 0;

  const timeSeries = useGeoPosts
    ? geoPosts!
        .sort((a, b) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return ta - tb;
        })
        .map((p) => {
          const interactions = (p.likes ?? 0) + (p.comments ?? 0);
          const er = followerCount > 0 ? interactions / followerCount : null;
          return {
            post_id: p.code,
            post_url: `https://www.instagram.com/p/${p.code}/`,
            post_type: p.media_type ?? null,
            caption: p.caption_excerpt ?? null,
            posted_at: p.timestamp || null,
            like_count: p.likes ?? null,
            comment_count: p.comments ?? null,
            view_count: p.views ?? null,
            engagement_rate: er,
            thumbnail_url: null,
          };
        })
    : (recentPosts ?? [])
        .sort((a, b) => {
          const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
          const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
          return ta - tb;
        })
        .map((p) => {
          const interactions = (p.like_count ?? 0) + (p.comment_count ?? 0);
          const er = followerCount > 0 ? interactions / followerCount : null;
          return {
            post_id: p.platform_post_id,
            post_url: p.post_url,
            post_type: p.post_type,
            caption: p.caption,
            posted_at: p.posted_at,
            like_count: p.like_count,
            comment_count: p.comment_count,
            view_count: p.view_count,
            engagement_rate: er,
            thumbnail_url: p.thumbnail_url ?? null,
          };
        });

  let postingFreq = { avg_days_between_posts: null as number | null, posts_per_week: null as number | null };
  const timestamps = timeSeries
    .filter((p) => p.posted_at)
    .map((p) => new Date(p.posted_at!).getTime())
    .sort((a, b) => a - b);
  if (timestamps.length >= 2) {
    const spanMs = timestamps[timestamps.length - 1]! - timestamps[0]!;
    const weeks = spanMs / (7 * 86400000);
    if (weeks > 0) postingFreq.posts_per_week = Math.round((timestamps.length / weeks) * 10) / 10;
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) gaps.push((timestamps[i]! - timestamps[i - 1]!) / 86400000);
    postingFreq.avg_days_between_posts = Math.round((gaps.reduce((s, v) => s + v, 0) / gaps.length) * 10) / 10;
  }

  let engagementTrend: ScrapedInsights['engagement_trend'] = 'insufficient_data';
  const ers = timeSeries.filter((p) => p.engagement_rate != null).map((p) => p.engagement_rate!);
  if (ers.length >= 3) {
    const half = Math.floor(ers.length / 2);
    const firstHalf = ers.slice(0, half);
    const secondHalf = ers.slice(half);
    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    const delta = (avgSecond - avgFirst) / (avgFirst || 1);
    if (delta > 0.15) engagementTrend = 'rising';
    else if (delta < -0.15) engagementTrend = 'declining';
    else engagementTrend = 'stable';
  }

  let confidence: InsightConfidence = 'very_low';
  if (timeSeries.length >= 10) confidence = 'medium';
  else if (timeSeries.length >= 5) confidence = 'low';

  // --- Brand work detection ---
  const rawMeta = creator.raw_metadata as unknown as Record<string, unknown> | undefined;
  const vision = rawMeta?.vision as Record<string, unknown> | undefined;

  const brandMentions = (vision?.brand_mentions as string[] | undefined) ?? [];
  const hasPaidPartnership = (vision?.has_paid_partnership as boolean | undefined) ?? false;
  const hasCollabTag = (vision?.has_collab_tag as boolean | undefined) ?? false;
  const contentThemes = (vision?.content_themes as string[] | undefined) ?? [];

  const SPONSORED_PATTERNS = [
    /#ad\b/i, /#sponsored\b/i, /#paidpartnership\b/i, /#collab\b/i,
    /#gifted\b/i, /#brandpartner\b/i, /paid\s*partnership/i,
  ];

  function detectSponsored(caption: string | null, brands: string[]): { detectedBrands: string[]; isSponsored: boolean } {
    if (!caption) return { detectedBrands: [], isSponsored: false };
    const lower = caption.toLowerCase();
    const detectedBrands = brands.filter((b) => lower.includes(b.toLowerCase()));
    const isSponsored = SPONSORED_PATTERNS.some((rx) => rx.test(caption)) || detectedBrands.length > 0;
    return { detectedBrands, isSponsored };
  }

  const sponsoredPosts: ScrapedInsights['brand_work']['sponsored_posts'] = [];
  for (const p of timeSeries) {
    const { detectedBrands, isSponsored } = detectSponsored(p.caption, brandMentions);
    if (isSponsored) {
      sponsoredPosts.push({
        post_id: p.post_id,
        post_url: p.post_url,
        caption: p.caption,
        posted_at: p.posted_at,
        like_count: p.like_count,
        comment_count: p.comment_count,
        view_count: p.view_count,
        detected_brands: detectedBrands,
        is_sponsored: isSponsored,
      });
    }
  }

  const brandWork: ScrapedInsights['brand_work'] = {
    brand_mentions: brandMentions,
    has_paid_partnership: hasPaidPartnership,
    has_collab_tag: hasCollabTag,
    content_themes: contentThemes,
    sponsored_posts: sponsoredPosts,
  };

  return {
    source: 'scraped',
    creator_id: creatorId,
    handle: creator.handle,
    display_name: creator.display_name ?? null,
    profile_photo_url: creator.profile_photo_url ?? null,
    follower_count: followerCount,
    following_count: creator.following_count != null ? Number(creator.following_count) : null,
    posts_count: creator.posts_count != null ? Number(creator.posts_count) : null,
    engagement_rate: creator.engagement_rate != null ? Number(creator.engagement_rate) : null,
    avg_likes: creator.avg_likes != null ? Number(creator.avg_likes) : null,
    avg_comments: creator.avg_comments != null ? Number(creator.avg_comments) : null,
    avg_views: creator.avg_views != null ? Number(creator.avg_views) : null,
    primary_category: creator.primary_category ?? null,
    audience_demographics: creator.audience_demographics ?? null,
    credibility: creator.credibility ?? null,
    time_series: timeSeries,
    posting_frequency: postingFreq,
    engagement_trend: engagementTrend,
    confidence,
    brand_work: brandWork,
  };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
