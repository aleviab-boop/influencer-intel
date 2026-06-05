import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph';
import { getAccessToken } from './oauth-service';
import type {
  ConnectedAccount, PostInsight, MonitoringUpdate,
  PerformanceBucket, InsightConfidence,
} from '@influencer-intel/shared/types';
import { computeCreatorInsights } from './insights-service';

interface MonitoredPost {
  id: string;
  connected_account_id: string;
  creator_id: string;
  post_insight_id: string | null;
  ig_media_id: string;
  permalink: string;
  monitoring_status: string;
  checkpoints_completed: string[];
  next_checkpoint_at: string | null;
  predictions: unknown;
  started_at: string;
  completed_at: string | null;
}

const CHECKPOINT_DELAYS: Record<string, number> = {
  '30min': 30 * 60 * 1000,
  '2hr': 2 * 60 * 60 * 1000,
  '6hr': 6 * 60 * 60 * 1000,
  '24hr': 24 * 60 * 60 * 1000,
};

const CHECKPOINT_ORDER = ['30min', '2hr', '6hr', '24hr'] as const;

export async function startMonitoring(args: {
  creator_id: string;
  post_url: string;
  ig_media_id?: string;
}): Promise<MonitoredPost> {
  const db = getBolticClient();

  const accounts = await db.query<ConnectedAccount>(
    `SELECT * FROM connected_accounts WHERE creator_id = $1 AND connection_status = 'active' LIMIT 1`,
    [args.creator_id],
  );
  if (accounts.length === 0) throw new Error('No active connected account — use post-analysis for scraped data');
  const account = accounts[0]!;

  const mediaId = args.ig_media_id ?? extractMediaId(args.post_url);

  const firstCheckpoint = new Date(Date.now() + CHECKPOINT_DELAYS['30min']!);

  return db.upsert<MonitoredPost>('monitored_posts', {
    connected_account_id: account.id,
    creator_id: args.creator_id,
    ig_media_id: mediaId,
    permalink: args.post_url,
    monitoring_status: 'active',
    checkpoints_completed: [],
    next_checkpoint_at: firstCheckpoint.toISOString(),
    predictions: [],
    started_at: new Date().toISOString(),
  }, ['ig_media_id']);
}

export async function processCheckpoint(monitoredPostId: string): Promise<MonitoringUpdate | null> {
  const db = getBolticClient();
  const post = await db.findById<MonitoredPost>('monitored_posts', monitoredPostId);
  if (!post || post.monitoring_status !== 'active') return null;

  const completed = post.checkpoints_completed as string[];
  const nextCheckpointName = CHECKPOINT_ORDER.find((c) => !completed.includes(c));
  if (!nextCheckpointName) {
    await db.update('monitored_posts', { id: post.id }, {
      monitoring_status: 'completed', completed_at: new Date().toISOString(),
    });
    return null;
  }

  const account = await db.findById<ConnectedAccount>('connected_accounts', post.connected_account_id);
  if (!account || account.connection_status !== 'active') return null;

  const token = await getAccessToken(account.id);
  const client = new IGGraphClient(token);

  // Fetch current metrics
  let currentMetrics = {
    likes: 0, comments: 0, saves: null as number | null,
    shares: null as number | null, reach: null as number | null, plays: null as number | null,
  };

  try {
    const insights = await client.getMediaInsights(post.ig_media_id, 'VIDEO');
    for (const metric of insights.data) {
      const val = metric.values[0]?.value ?? 0;
      switch (metric.name) {
        case 'likes': currentMetrics.likes = val; break;
        case 'comments': currentMetrics.comments = val; break;
        case 'saved': currentMetrics.saves = val; break;
        case 'shares': currentMetrics.shares = val; break;
        case 'reach': currentMetrics.reach = val; break;
        case 'plays': currentMetrics.plays = val; break;
      }
    }
  } catch (err) {
    console.warn(`[monitor] insights fetch failed for ${post.ig_media_id}:`, (err as Error).message);
    return null;
  }

  // Compute velocity
  const elapsedHours = (Date.now() - new Date(post.started_at).getTime()) / 3600000;
  const velocity = {
    likes_per_hour: elapsedHours > 0 ? currentMetrics.likes / elapsedHours : 0,
    comments_per_hour: elapsedHours > 0 ? currentMetrics.comments / elapsedHours : 0,
    reach_per_hour: currentMetrics.reach != null && elapsedHours > 0 ? currentMetrics.reach / elapsedHours : null,
  };

  // Predict based on early signals (SEISMIC-inspired)
  const creatorInsights = await computeCreatorInsights(post.creator_id);
  const predictedBucket = predictFromEarlySignals(velocity, nextCheckpointName, creatorInsights);

  // Trend detection from velocity
  const isHighVelocity = velocity.likes_per_hour > (creatorInsights?.rolling_er_30d ?? 0.02) * 1000;
  const is_trending = isHighVelocity && nextCheckpointName !== '24hr';
  const trend_signals: string[] = [];
  if (is_trending) trend_signals.push('High engagement velocity detected');
  if (velocity.reach_per_hour && velocity.reach_per_hour > 1000) trend_signals.push('Strong reach expansion');

  // Predicted ER range
  const creator = await db.findById<{ follower_count: number }>('creators', post.creator_id);
  const fc = creator?.follower_count ?? 10000;
  const currentEr = (currentMetrics.likes + currentMetrics.comments + (currentMetrics.saves ?? 0)) / fc;

  // Day-1 views predict Day-30 with SRC 0.959 — narrow the range over time
  const narrowingFactor = nextCheckpointName === '30min' ? 0.5
    : nextCheckpointName === '2hr' ? 0.3 : nextCheckpointName === '6hr' ? 0.15 : 0.05;
  const predicted_er_range: [number, number] = [
    currentEr * (1 - narrowingFactor),
    currentEr * (1 + narrowingFactor + (is_trending ? 0.5 : 0)),
  ];

  const confidence: InsightConfidence = nextCheckpointName === '24hr' ? 'high'
    : nextCheckpointName === '6hr' ? 'medium' : 'low';

  const update: MonitoringUpdate = {
    post_id: post.ig_media_id,
    creator_id: post.creator_id,
    checkpoint: nextCheckpointName,
    current_metrics: currentMetrics,
    velocity,
    predicted_bucket: predictedBucket,
    predicted_er_range,
    confidence,
    is_trending,
    trend_signals,
  };

  // Persist
  const newCompleted = [...completed, nextCheckpointName];
  const nextIdx = CHECKPOINT_ORDER.indexOf(nextCheckpointName) + 1;
  const nextCheckpointAt = nextIdx < CHECKPOINT_ORDER.length
    ? new Date(new Date(post.started_at).getTime() + CHECKPOINT_DELAYS[CHECKPOINT_ORDER[nextIdx]!]!).toISOString()
    : null;

  const existingPredictions = (post.predictions ?? []) as unknown[];

  await db.update('monitored_posts', { id: post.id }, {
    checkpoints_completed: newCompleted,
    next_checkpoint_at: nextCheckpointAt,
    predictions: [...existingPredictions, update],
    ...(nextIdx >= CHECKPOINT_ORDER.length ? { monitoring_status: 'completed', completed_at: new Date().toISOString() } : {}),
  });

  // Update post_insights with latest metrics
  if (post.post_insight_id) {
    await db.update('post_insights', { id: post.post_insight_id }, {
      like_count: currentMetrics.likes, comment_count: currentMetrics.comments,
      saved: currentMetrics.saves, shares: currentMetrics.shares,
      reach: currentMetrics.reach, plays: currentMetrics.plays,
      engagement_rate: currentEr,
      insights_fetched_at: new Date().toISOString(),
    });
  }

  return update;
}

function predictFromEarlySignals(
  velocity: MonitoringUpdate['velocity'],
  checkpoint: string,
  insights: Awaited<ReturnType<typeof computeCreatorInsights>> | null,
): PerformanceBucket {
  const baselineVelocity = (insights?.rolling_er_30d ?? 0.02) * 500;
  const currentVelocity = velocity.likes_per_hour + velocity.comments_per_hour * 3;

  const ratio = baselineVelocity > 0 ? currentVelocity / baselineVelocity : 1;

  if (ratio >= 3.0) return 'breakout';
  if (ratio >= 1.5) return 'above_average';
  if (ratio >= 0.7) return 'average';
  return 'below_average';
}

export async function processDueCheckpoints(): Promise<number> {
  const db = getBolticClient();
  const due = await db.query<MonitoredPost>(
    `SELECT * FROM monitored_posts WHERE monitoring_status = 'active' AND next_checkpoint_at <= NOW() LIMIT 50`,
  );
  let processed = 0;
  for (const post of due) {
    try {
      await processCheckpoint(post.id);
      processed++;
    } catch (err) {
      console.error(`[monitor] checkpoint failed for ${post.id}:`, (err as Error).message);
    }
  }
  return processed;
}

function extractMediaId(url: string): string {
  const match = url.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? url;
}
