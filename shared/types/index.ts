// ============================================================
// Shared types — mirrors the 6-table Boltic schema in /db/schema.sql
// ============================================================

export type Platform = 'instagram' | 'youtube';
export type DataTier = 'tier_a' | 'tier_b' | 'tier_c';
export type CityTier = 'tier_1' | 'tier_2' | 'tier_3' | 'unknown';
export type CredibilityBadge = 'green' | 'amber' | 'red';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type CampaignType = 'brand_launch' | 'festive' | 'important_days' | 'travel';
export type BriefStatus = 'pending' | 'parsed' | 'shortlisted' | 'archived';
export type BrandPlan = 'design_partner' | 'growth' | 'scale';
export type ServiceAccountStatus = 'warming' | 'active' | 'flagged' | 'banned' | 'retired';
export type ScrapeJobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'skipped';
export type DemographicSource = 'inferred_scraping' | 'verified_oauth';
export type OutreachChannel = 'ig_dm' | 'email';
export type OutreachStatus = 'draft' | 'edited' | 'sent' | 'skipped' | 'opened' | 'replied' | 'negotiating' | 'confirmed';
export type ReplyClassification = 'interested' | 'declined' | 'negotiating' | 'question';
export type BrandActionOnCreator = 'selected' | 'dropped' | 'pending';
export type Freshness = 'just_scraped' | 'fresh' | 'stale' | 'refreshing';

export type ScrapeJobType =
  | 'on_demand'
  | 'refresh'
  | 'audience_inference'
  | 'discovery_crawl'
  | 'search_query'
  | 'comment_sample'
  | 'credibility_recompute';

// ============================================================
// JSONB shapes (folded onto tables below)
// ============================================================

export interface RecentPost {
  platform_post_id: string;
  post_url: string;
  post_type: string | null;
  caption: string | null;
  posted_at: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  thumbnail_url?: string | null;
  alt_text?: string | null;
}

export interface AudienceDemographics {
  source: DemographicSource;
  sample_size: number | null;
  confidence: ConfidenceLevel;
  gender: { male_pct: number | null; female_pct: number | null; other_pct: number | null };
  age_bands: { '18_24': number | null; '25_34': number | null; '35_44': number | null; '45_64': number | null };
  top_cities: { city: string; state?: string; pct: number }[];
  country_india_pct: number | null;
  top_languages: { lang: string; pct: number }[];
  computed_at: string;
}

export interface CredibilityData {
  overall_score: number;
  badge: CredibilityBadge;
  signals: {
    follower_engagement_ratio: number | null;
    engagement_velocity: number | null;
    comment_to_like_ratio: number | null;
    follower_growth_pattern: number | null;
    audience_geo_authenticity: number | null;
    brand_safety: number | null;
    comment_text_quality: number | null;
    audience_account_age: number | null;
    story_engagement_parity: number | null;
    hashtag_engagement_match: number | null;
  };
  flags: string[];
  computed_at: string;
}

export interface VerifiedOauthData {
  email: string;
  oauth_provider: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string | null;
  insights?: unknown;
  insights_fetched_at?: string;
  subscription_tier?: string;
}

export interface BrandUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'member';
  gmail_oauth_token_encrypted?: string;
  ig_oauth_token_encrypted?: string;
  last_login_at?: string;
}

export interface ParsedBriefSpec {
  campaign_type: CampaignType | null;
  category: string | null;
  target_gender: string | null;
  target_age_min: number | null;
  target_age_max: number | null;
  target_cities: string[];
  target_languages: string[];
  budget_amount: number | null;
  vibe: string | null;
  reference_creators: string[];
  excluded_creators: string[];
  // Phase 1 discovery fields — broad genre, fine niche, geographic region,
  // and free keywords extracted from the prompt for tag matching.
  genre: string | null;
  niche: string | null;
  region: string | null;
  keywords: string[];
}

// ============================================================
// Phase 1 — prompt-driven discovery
// ============================================================

export type DiscoverySource = 'icmp' | 'trends' | 'scrape' | 'manual';

// Phase 2 quality scoring (computed by shared/scoring/quality.ts)
export type QualityBand = 'pass' | 'weak' | 'insufficient_data';

export interface QualityBreakdown {
  engagement: number;
  comment_quality: number;
  consistency: number;
  authenticity: number;
}

export interface DiscoveryResult {
  id: string;
  prompt: string;
  prompt_embedding: number[] | null;
  creator_id: string;
  rank: number;
  relevance_score: number | null;
  confidence_score: number | null;
  matched_tags: string[] | null;
  source: DiscoverySource | null;
  created_at: string;
}

// ============================================================
// Discover & Recruit — programs
// ============================================================

export type ProgramStatus = 'active' | 'paused' | 'closed';
export type RecruitStatus = 'invited' | 'contacted' | 'recruited' | 'declined';

export interface Program {
  id: string;
  brand_id: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  source_prompt: string | null;
  status: ProgramStatus;
  budget: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramRecruit {
  id: string;
  program_id: string;
  creator_id: string;
  status: RecruitStatus;
  source_prompt: string | null;
  note: string | null;
  relevance_score: number | null;
  confidence_score: number | null;
  deliverables: string | null;
  due_date: string | null;
  rate: number | null;
  paid: boolean;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Comment-to-DM automations
// ============================================================

export type AutomationStatus = 'active' | 'paused' | 'draft';
export type TriggerType = 'keyword' | 'any';
export type RunStatus = 'simulated' | 'sent' | 'skipped' | 'failed';

export interface Automation {
  id: string;
  connected_account_id: string | null;
  name: string;
  post_label: string | null;
  media_id: string | null;
  trigger_type: TriggerType;
  keyword: string | null;
  dm_message: string;
  comment_reply: string | null;
  status: AutomationStatus;
  reply_count: number;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  commenter: string | null;
  comment_text: string | null;
  matched: boolean;
  dm_sent: string | null;
  status: RunStatus;
  created_at: string;
}

// ============================================================
// Media Management — creative assets
// ============================================================

export type AssetType = 'reel' | 'image' | 'carousel' | 'story';
export type AssetStatus = 'draft' | 'in_review' | 'approved' | 'changes';

export interface CreativeAsset {
  id: string;
  program_id: string | null;
  creator_handle: string | null;
  title: string;
  asset_type: AssetType;
  asset_url: string | null;
  caption: string | null;
  status: AssetStatus;
  version: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Phase 3 — predicted-vs-real tracking
// ============================================================

export interface PostOutcome {
  id: string;
  creator_id: string;
  program_id: string | null;
  post_url: string | null;
  posted_at: string | null;
  predicted_er: number | null;
  predicted_likes: number | null;
  predicted_views: number | null;
  actual_likes: number | null;
  actual_comments: number | null;
  actual_views: number | null;
  actual_er: number | null;
  note: string | null;
  created_at: string;
}

export interface OutreachRecord {
  channel: OutreachChannel;
  draft_text: string;
  edited_text?: string | null;
  status: OutreachStatus;
  generated_at: string;
  sent_at?: string | null;
  replied_at?: string | null;
  reply_text?: string | null;
  reply_classification?: ReplyClassification | null;
}

export interface OutcomeRecord {
  post_url: string;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  predicted_engagement_rate: number | null;
  actual_engagement_rate: number | null;
  brand_rating: number | null;
  brand_notes: string | null;
  fetched_at: string | null;
}

// ============================================================
// Tables (1) — creators
// ============================================================

export interface Creator {
  id: string;
  platform: Platform;
  handle: string;
  profile_url: string;
  display_name: string | null;
  bio: string | null;
  profile_photo_url: string | null;
  is_verified: boolean;
  follower_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  avg_views: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  engagement_rate: number | null;
  primary_category: string | null;
  content_languages: string[] | null;
  primary_city: string | null;
  city_tier: CityTier | null;
  data_tier: DataTier;
  // Phase 1 discovery facts (see migration 004)
  genre: string | null;
  niche: string | null;
  region: string | null;
  tags: string[] | null;
  source: DiscoverySource | null;
  source_url: string | null;
  confidence_score: number | null;
  // Phase 2 quality (see migration 006)
  quality_score: number | null;
  quality_breakdown: QualityBreakdown | null;
  quality_band: QualityBand | null;
  quality_scored_at: string | null;
  is_active: boolean;
  is_indian: boolean | null;
  is_verified_creator: boolean;
  recent_posts: RecentPost[] | null;
  audience_demographics: AudienceDemographics | null;
  credibility: CredibilityData | null;
  verified_oauth_data: VerifiedOauthData | null;
  /** Rich profile metadata captured by the extension. */
  raw_metadata: CreatorRawMetadata | null;
  content_embedding: number[] | null;
  first_indexed_at: string;
  last_scraped_at: string | null;
  last_full_refresh: string | null;
}

export interface CreatorRawMetadata {
  external_link: string | null;
  category: string | null;
  account_type: string | null;
  tier: 'mega' | 'macro' | 'micro' | 'nano' | null;
  follower_to_following_ratio: number | null;
  highlights_count: number | null;
  reel_count_in_grid: number | null;
  post_count_in_grid: number | null;
  is_indian_inferred: boolean;
  language_inferred: string | null;
  og: { title: string | null; description: string | null; image: string | null; url: string | null };
  page_url: string;
  extracted_at: string;
  /** GPT-4o vision-based enrichment from profile screenshot. */
  vision?: VisionEnrichment;
  vision_extracted_at?: string;
}

/** GPT-4o vision-extracted profile fields. */
export interface VisionEnrichment {
  bio_text?: string | null;
  niche?: string | null;
  sub_niches?: string[];
  content_themes?: string[];
  post_types_visible?: string[];
  brand_mentions?: string[];
  has_paid_partnership?: boolean;
  has_collab_tag?: boolean;
  visible_external_link?: string | null;
  contact_button_visible?: boolean;
  highlights?: string[];
  visible_post_count?: number;
  estimated_audience_age_band?: string;
  estimated_audience_gender_skew?: string;
  vibe_tags?: string[];
  tier_signal?: string;
  india_signal?: boolean;
  language_signal?: string[];
  safety_concerns?: string[];
  engagement_quality_signal?: string;
  profile_completeness_score?: number;
  visual_quality_score?: number;
}

// ============================================================
// Tables (2) — brands
// ============================================================

export interface Brand {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  voice_samples: { type: string; text: string }[] | null;
  users: BrandUser[] | null;
  plan: BrandPlan | null;
  research_quota_used: number;
  research_quota_max: number;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Tables (3) — briefs
// ============================================================

export interface Brief {
  id: string;
  brand_id: string;
  raw_text: string;
  parsed_spec: ParsedBriefSpec | null;
  brief_embedding: number[] | null;
  status: BriefStatus;
  created_at: string;
  parsed_at: string | null;
}

// ============================================================
// Tables (4) — brief_creators (the shortlist)
// ============================================================

export interface BriefCreator {
  id: string;
  brief_id: string;
  brand_id: string;
  creator_id: string;
  rank: number;
  match_score: number;
  reasoning: string | null;
  freshness: Freshness | null;
  outreach: OutreachRecord | null;
  outcome: OutcomeRecord | null;
  brand_action: BrandActionOnCreator | null;
  brand_action_at: string | null;
  created_at: string;
}

// ============================================================
// Tables (5) — scrape_jobs
// ============================================================

export interface ScrapeJob {
  id: string;
  job_type: ScrapeJobType;
  target_platform: Platform | null;
  target_handle: string;
  creator_id: string | null;
  brief_id: string | null;
  priority: number;
  status: ScrapeJobStatus;
  attempts: number;
  assigned_account_id: string | null;
  result_summary: unknown;
  error_message: string | null;
  requested_by_brand: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ============================================================
// Tables (6) — service_accounts
// ============================================================

export interface ServiceAccount {
  id: string;
  platform: Platform;
  handle: string;
  email: string | null;
  phone_number: string | null;
  storage_state: unknown;
  storage_captured_at: string | null;
  storage_expires_at: string | null;
  status: ServiceAccountStatus;
  proxy_assignment: string | null;
  device_fingerprint: unknown;
  daily_action_count: number;
  total_scrapes: number;
  category_focus: string | null;
  geo_focus: string | null;
  warmed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// API contracts (scraper → platform callback)
// ============================================================

export interface ScrapeCompletionEvent {
  job_id: string;
  job_type: ScrapeJobType;
  target_handle: string;
  creator_id: string | null;
  brief_id: string | null;
  success: boolean;
  error_message: string | null;
}

export interface ExtensionExtractionResult {
  handle: string;
  platform_user_id: string | null;
  display_name: string | null;
  bio: string | null;
  profile_photo_url: string | null;
  is_verified: boolean;
  follower_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  external_link?: string | null;
  category?: string | null;
  account_type?: string | null;
  tier?: 'mega' | 'macro' | 'micro' | 'nano' | null;
  follower_to_following_ratio?: number | null;
  highlights_count?: number | null;
  reel_count_in_grid?: number | null;
  post_count_in_grid?: number | null;
  is_indian_inferred?: boolean;
  language_inferred?: string | null;
  recent_posts: RecentPost[];
  hashtags_seen: string[];
  og?: { title: string | null; description: string | null; image: string | null; url: string | null };
  page_url?: string;
  extracted_at: string;
}

// ============================================================
// SSE event types (platform → brand UI)
// ============================================================

export type ShortlistEvent =
  | {
      type: 'preliminary';
      brief_id: string;
      creators: ShortlistCreatorView[];
      pending_count: number;
    }
  | {
      type: 'creator_added';
      brief_id: string;
      creator: ShortlistCreatorView;
      rank: number;
    }
  | {
      type: 'reranked';
      brief_id: string;
      ordered_brief_creator_ids: string[];
    }
  | {
      type: 'progress';
      brief_id: string;
      done: number;
      total: number;
    }
  | {
      type: 'complete';
      brief_id: string;
      final_count: number;
    };

/** Shape served from /api/briefs/[id] and SSE events. */
export * from './growth-engine';

export interface ShortlistCreatorView {
  brief_creator_id: string;
  creator: Pick<
    Creator,
    | 'id'
    | 'handle'
    | 'platform'
    | 'display_name'
    | 'profile_photo_url'
    | 'follower_count'
    | 'following_count'
    | 'posts_count'
    | 'engagement_rate'
    | 'primary_city'
    | 'primary_category'
    | 'content_languages'
    | 'data_tier'
    | 'is_verified'
    | 'is_indian'
    | 'bio'
  >;
  match_score: number;
  rank: number;
  reasoning: string | null;
  freshness: Freshness;
  credibility?: { overall_score: number; badge: CredibilityBadge; signals?: CredibilityData['signals']; flags?: string[] };
  audience?: {
    confidence: ConfidenceLevel;
    gender_female_pct: number | null;
    top_cities: { city: string; pct: number }[] | null;
  };
  raw_metadata?: CreatorRawMetadata | null;
}
