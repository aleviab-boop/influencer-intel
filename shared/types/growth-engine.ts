export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';
export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';
export type PerformanceBucket = 'breakout' | 'above_average' | 'average' | 'below_average';
export type InsightConfidence = 'high' | 'medium' | 'low' | 'very_low';

export interface ConnectedAccount {
  id: string;
  creator_id: string;
  brand_id: string | null;
  ig_user_id: string;
  ig_username: string;
  access_token_encrypted: string;
  token_expires_at: string | null;
  scopes: string[];
  connection_status: ConnectionStatus;
  last_sync_at: string | null;
  last_sync_status: SyncStatus;
  sync_error: string | null;
  posts_synced_count: number;
  connected_at: string;
  updated_at: string;
}

export interface PostInsight {
  id: string;
  connected_account_id: string;
  creator_id: string;
  ig_media_id: string;
  ig_shortcode: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  media_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  permalink: string;
  posted_at: string;
  like_count: number;
  comment_count: number;
  reach: number | null;
  impressions: number | null;
  saved: number | null;
  shares: number | null;
  plays: number | null;
  total_interactions: number | null;
  engagement_rate: number | null;
  performance_bucket: PerformanceBucket | null;
  content_scores: ContentScores | null;
  content_scored_at: string | null;
  fetched_at: string;
  insights_fetched_at: string | null;
}

export interface ContentScores {
  hook_strength: number;
  retention_design: number;
  information_density: number;
  emotional_trigger: number;
  production_quality: number;
  trend_leverage: number;
  brand_integration: number;
  cta_effectiveness: number;
  audio_fit: number;
  shareability: number;
  comment_magnetism: number;
  niche_authority: number;
  overall_weighted: number;
  improvement_suggestions: string[];
}

export interface CreatorInsights {
  creator_id: string;
  connected_account_id: string;
  rolling_er_30d: number | null;
  rolling_er_90d: number | null;
  breakout_rate: number | null;
  breakout_threshold: number | null;
  consistency_score: number | null;
  er_coefficient_of_variation: number | null;
  follower_growth_30d: number | null;
  follower_growth_90d: number | null;
  posts_per_week: number | null;
  avg_days_between_posts: number | null;
  audience_quality_score: number | null;
  audience_demographics: {
    gender: { male_pct: number; female_pct: number };
    top_age_band: string;
    top_cities: Array<{ city: string; pct: number }>;
    top_countries: Array<{ country: string; pct: number }>;
  } | null;
  top_posts: Array<{ ig_shortcode: string; er: number; bucket: PerformanceBucket }>;
  worst_posts: Array<{ ig_shortcode: string; er: number; bucket: PerformanceBucket }>;
  best_posting_hours: number[];
  best_posting_days: number[];
  computed_at: string;
  confidence: InsightConfidence;
}

export interface PredictionResult {
  bucket: PerformanceBucket;
  bucket_probability: number;
  predicted_er_range: [number, number];
  predicted_er_median: number;
  confidence: InsightConfidence;
  creator_baseline_er: number;
  content_multiplier: number;
  temporal_multiplier: number;
  trend_multiplier: number;
  competition_multiplier: number;
  optimal_post_window: { start: string; end: string } | null;
  trend_alignment_score: number;
  improvement_suggestions: string[];
}

export interface MonitoringUpdate {
  post_id: string;
  creator_id: string;
  checkpoint: '30min' | '2hr' | '6hr' | '24hr';
  current_metrics: {
    likes: number;
    comments: number;
    saves: number | null;
    shares: number | null;
    reach: number | null;
    plays: number | null;
  };
  velocity: {
    likes_per_hour: number;
    comments_per_hour: number;
    reach_per_hour: number | null;
  };
  predicted_bucket: PerformanceBucket;
  predicted_er_range: [number, number];
  confidence: InsightConfidence;
  is_trending: boolean;
  trend_signals: string[];
}

export interface TrendSignal {
  id: string;
  trend_type: 'audio' | 'format' | 'hashtag' | 'topic';
  identifier: string;
  display_name: string;
  phase: 'emerging' | 'growing' | 'peak' | 'saturated' | 'declining';
  velocity: number;
  first_seen_at: string;
  peak_at: string | null;
  usage_count_24h: number;
  usage_count_7d: number;
  avg_er_boost: number | null;
  categories: string[];
  updated_at: string;
}

export interface ContentScoreRequest {
  media_url: string;
  media_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';
  caption?: string;
  creator_category?: string;
}

export interface ContentScoreResponse {
  scores: ContentScores;
  overall_bucket_estimate: PerformanceBucket;
  confidence: InsightConfidence;
}
