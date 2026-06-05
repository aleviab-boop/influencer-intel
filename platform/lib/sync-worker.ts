import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph';
import { getAccessToken } from './oauth-service';
import type { ConnectedAccount, PostInsight, Creator, AudienceDemographics } from '@influencer-intel/shared/types';

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
    const media = await client.getAllMedia(200);
    let postsAdded = 0;
    let insightsUpdated = 0;

    const creator = await db.findById<Creator>('creators', account.creator_id);
    const followerCount = creator?.follower_count ?? null;

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

      if (followerCount && followerCount > 0) {
        const interactions = (row.like_count as number) + (row.comment_count as number)
          + ((row.saved as number | undefined) ?? 0) + ((row.shares as number | undefined) ?? 0);
        row.engagement_rate = interactions / followerCount;
      }

      await db.upsert('post_insights', row, ['connected_account_id', 'ig_media_id']);
      postsAdded++;
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
