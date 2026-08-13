import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph';
import { getAccessToken } from './oauth-service';
import { audienceQuality, type QualityPost } from './audience-quality';
import type {
  ConnectedAccount, PostInsight, Creator, AudienceDemographics,
  CredibilityData, CredibilityBadge,
} from '@influencer-intel/shared/types';

export async function syncConnectedAccount(accountId: string): Promise<{
  postsAdded: number;
  insightsUpdated: number;
}> {
  const db = getBolticClient();
  const account = await db.findById<ConnectedAccount>('connected_accounts', accountId);
  if (!account || account.connection_status !== 'active') {
    throw new Error(`Account ${accountId} not found or not active`);
  }

  await db.update('connected_accounts', { id: accountId }, {
    last_sync_status: 'syncing', updated_at: new Date().toISOString(),
  });

  try {
    const token = await getAccessToken(accountId);
    const client = new IGGraphClient(token);

    // Pull the live profile FIRST so follower count / bio / photo land on the
    // creator row — the dashboard reads these fields, and without this the
    // stats stay at whatever was seeded (often 0).
    const creator = await db.findById<Creator>('creators', account.creator_id);
    const profile = await client.getProfile().catch((err) => {
      console.warn(`[sync] profile fetch failed:`, (err as Error).message);
      return null;
    });

    const liveFollowers = profile?.followers_count ?? creator?.follower_count ?? null;

    if (profile) {
      const creatorPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (profile.followers_count != null) creatorPatch.follower_count = profile.followers_count;
      if (profile.follows_count != null) creatorPatch.following_count = profile.follows_count;
      if (profile.media_count != null) creatorPatch.posts_count = profile.media_count;
      if (profile.profile_picture_url) creatorPatch.profile_photo_url = profile.profile_picture_url;
      // Don't clobber creator-edited display fields — only fill if empty.
      if (profile.name && !creator?.display_name?.trim()) creatorPatch.display_name = profile.name;
      if (profile.biography && !creator?.bio?.trim()) creatorPatch.bio = profile.biography;
      await db.update('creators', { id: account.creator_id }, creatorPatch);
    }

    const media = await client.getAllMedia(200);
    let postsAdded = 0;
    let insightsUpdated = 0;
    // Accumulators for the creator-level engagement roll-up.
    let sumLikes = 0, sumComments = 0, sumInteractions = 0, engCount = 0;
    // Per-post signals fed into the audience-quality / credibility score.
    const qualityPosts: QualityPost[] = [];

    for (const post of media) {
      const row: Record<string, unknown> = {
        connected_account_id: accountId,
        creator_id: account.creator_id,
        ig_media_id: post.id,
        ig_shortcode: post.shortcode,
        media_type: post.media_type,
        media_url: post.media_url ?? null,
        thumbnail_url: post.thumbnail_url ?? null,
        caption: post.caption ?? null,
        permalink: post.permalink,
        posted_at: post.timestamp,
        like_count: post.like_count ?? 0,
        comment_count: post.comments_count ?? 0,
        fetched_at: new Date().toISOString(),
      };

      try {
        const insights = await client.getMediaInsights(post.id, post.media_type);
        for (const metric of insights.data) {
          const val = metric.values[0]?.value ?? 0;
          switch (metric.name) {
            case 'reach': row.reach = val; break;
            case 'impressions': row.impressions = val; break;
            case 'saved': row.saved = val; break;
            case 'shares': row.shares = val; break;
            case 'plays': row.plays = val; break;
            case 'total_interactions': row.total_interactions = val; break;
          }
        }
        row.insights_fetched_at = new Date().toISOString();
        insightsUpdated++;
      } catch (err) {
        console.warn(`[sync] insights failed for ${post.id}:`, (err as Error).message);
      }

      const interactions = (row.like_count as number) + (row.comment_count as number)
        + ((row.saved as number | undefined) ?? 0) + ((row.shares as number | undefined) ?? 0);
      if (liveFollowers && liveFollowers > 0) {
        row.engagement_rate = interactions / liveFollowers;
      }
      sumLikes += row.like_count as number;
      sumComments += row.comment_count as number;
      sumInteractions += interactions;
      engCount++;
      qualityPosts.push({
        media_type: post.media_type,
        like_count: row.like_count as number,
        comments_count: row.comment_count as number,
        er: (row.engagement_rate as number | undefined) ?? null,
        reach: (row.reach as number | undefined) ?? null,
      });

      await db.upsert('post_insights', row, ['connected_account_id', 'ig_media_id']);
      postsAdded++;
    }

    // Roll up post-level numbers to the creator row so the dashboard's
    // Engagement / averages reflect real, freshly-synced content.
    if (engCount > 0) {
      const avgInteractions = sumInteractions / engCount;
      const creatorRollup: Record<string, unknown> = {
        avg_likes: Math.round(sumLikes / engCount),
        avg_comments: Math.round(sumComments / engCount),
        updated_at: new Date().toISOString(),
      };
      if (liveFollowers && liveFollowers > 0) {
        creatorRollup.engagement_rate = avgInteractions / liveFollowers;
      }
      await db.update('creators', { id: account.creator_id }, creatorRollup);
    }

    // Verified credibility / quality score — derived from the freshly-synced
    // posts + live follower count, then persisted to creators.credibility so the
    // dashboard's QUALITY stat and brand-facing credibility badges go live.
    const aq = audienceQuality(liveFollowers, qualityPosts);
    if (aq.available && aq.score != null) {
      const totalLikes = qualityPosts.reduce((s, p) => s + (p.like_count || 0), 0);
      const totalComments = qualityPosts.reduce((s, p) => s + (p.comments_count || 0), 0);
      const ers = qualityPosts.map((p) => p.er).filter((v): v is number => v != null && v > 0);
      const avgEr = ers.length ? ers.reduce((s, v) => s + v, 0) / ers.length : null;
      const badge: CredibilityBadge = aq.score >= 70 ? 'green' : aq.score >= 45 ? 'amber' : 'red';
      const credibility: CredibilityData = {
        overall_score: aq.score,
        badge,
        signals: {
          follower_engagement_ratio: avgEr,
          engagement_velocity: null,
          comment_to_like_ratio: totalLikes > 0 ? totalComments / totalLikes : null,
          follower_growth_pattern: null,
          audience_geo_authenticity: null,
          brand_safety: null,
          comment_text_quality: null,
          audience_account_age: null,
          story_engagement_parity: null,
          hashtag_engagement_match: null,
        },
        flags: aq.signals.filter((s) => s.status === 'concern').map((s) => s.label),
        computed_at: new Date().toISOString(),
      };
      await db.update('creators', { id: account.creator_id }, {
        credibility,
        updated_at: new Date().toISOString(),
      });
    }

    try {
      const demographics = await client.getAudienceDemographics();
      await updateCreatorDemographics(account.creator_id, demographics);
    } catch (err) {
      console.warn(`[sync] demographics failed:`, (err as Error).message);
    }

    await assignPerformanceBuckets(accountId);

    await db.update('connected_accounts', { id: accountId }, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'completed',
      posts_synced_count: postsAdded,
      sync_error: null,
      updated_at: new Date().toISOString(),
    });

    return { postsAdded, insightsUpdated };
  } catch (err) {
    await db.update('connected_accounts', { id: accountId }, {
      last_sync_status: 'failed',
      sync_error: (err as Error).message,
      updated_at: new Date().toISOString(),
    });
    throw err;
  }
}

async function assignPerformanceBuckets(accountId: string): Promise<void> {
  const db = getBolticClient();
  const posts = await db.query<PostInsight>(
    `SELECT * FROM post_insights WHERE connected_account_id = $1 AND engagement_rate IS NOT NULL ORDER BY posted_at DESC`,
    [accountId],
  );
  if (posts.length < 5) return;

  const ers = posts.map((p) => p.engagement_rate!).sort((a, b) => a - b);
  const p35 = ers[Math.floor(ers.length * 0.35)]!;
  const p65 = ers[Math.floor(ers.length * 0.65)]!;
  const p90 = ers[Math.floor(ers.length * 0.90)]!;

  for (const post of posts) {
    if (post.engagement_rate == null) continue;
    let bucket: string;
    if (post.engagement_rate >= p90) bucket = 'breakout';
    else if (post.engagement_rate >= p65) bucket = 'above_average';
    else if (post.engagement_rate >= p35) bucket = 'average';
    else bucket = 'below_average';
    if (bucket !== post.performance_bucket) {
      await db.update('post_insights', { id: post.id }, { performance_bucket: bucket });
    }
  }
}

async function updateCreatorDemographics(
  creatorId: string,
  demographics: { gender_age: Record<string, number>; cities: Record<string, number>; countries: Record<string, number> },
): Promise<void> {
  const db = getBolticClient();
  let malePct = 0, femalePct = 0, total = 0;
  for (const [key, val] of Object.entries(demographics.gender_age)) {
    total += val;
    if (key.startsWith('M.')) malePct += val;
    else if (key.startsWith('F.')) femalePct += val;
  }
  if (total > 0) { malePct = Math.round((malePct / total) * 100); femalePct = Math.round((femalePct / total) * 100); }

  const cityTotal = Object.values(demographics.cities).reduce((s, v) => s + v, 0);
  const topCities = Object.entries(demographics.cities)
    .sort(([, a], [, b]) => b - a).slice(0, 10)
    .map(([city, count]) => ({ city, pct: cityTotal > 0 ? Math.round((count / cityTotal) * 100) : 0 }));

  const countryTotal = Object.values(demographics.countries).reduce((s, v) => s + v, 0);

  const audienceDemographics: AudienceDemographics = {
    source: 'verified_oauth',
    sample_size: total,
    confidence: 'high',
    gender: { male_pct: malePct, female_pct: femalePct, other_pct: Math.max(0, 100 - malePct - femalePct) },
    age_bands: { '18_24': null, '25_34': null, '35_44': null, '45_64': null },
    top_cities: topCities,
    country_india_pct: demographics.countries['IN'] && countryTotal > 0
      ? Math.round((demographics.countries['IN'] / countryTotal) * 100) : null,
    top_languages: [],
    computed_at: new Date().toISOString(),
  };

  await db.update('creators', { id: creatorId }, { audience_demographics: audienceDemographics });
}
