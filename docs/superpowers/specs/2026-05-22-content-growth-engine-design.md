# Content Growth Engine - Design Spec

**Date**: 2026-05-22
**Status**: Draft
**Product**: Influencer Intel

---

## 1. What This Is

A prediction + optimization engine for organic content performance. Works for any content type (brand reels, creator posts, ad creatives) from any source (brand's own account, influencer partnerships, paid campaigns). Analogous to Tempo for paid ads, but for organic/influencer content.

**Core question it answers**: "Will this content perform well, and when/how should we publish it?"

## 2. The Honest Math

### Engagement Variance Decomposition (from research)

| Factor | Variance Explained | Data Source |
|--------|-------------------|-------------|
| Creator history (baseline, audience, consistency) | 30-40% | Connected account metrics |
| Content quality (hook, retention, production) | 10-20% | Gemini 2.5 Flash scoring |
| Social influence cascades (early sharing, network effects) | 15-25% | Early engagement signals |
| Algorithmic amplification (IG's 1000+ ML models) | 10-15% | Inferred from distribution patterns |
| Clock time (hour, day, season, competition) | 2-5% | Posting timestamps + follower activity |
| Irreducible stochastic noise | 10-20% | Cannot be modeled |

**Key constraint (Hofman-Watts, Science 2017)**: ~50% of content performance variance is fundamentally unpredictable. The system predicts RANGES, not points, and uses performance BUCKETS.

### What's Achievable

| Model Stage | PR AUC | Data Required |
|-------------|--------|---------------|
| Content-only (no creator data) | 0.13 | Video/image analysis |
| Global baseline (scraped history) | 0.35-0.43 | 50+ posts per creator |
| Connected account (private metrics) | 0.55-0.65 | OAuth + 30d history |
| Real-time (2hr early engagement) | 0.65-0.75 | Live post monitoring |

## 3. Prediction Architecture

### 3.1 The Formula

```
predicted_ER = creator_baseline
             * content_multiplier
             * temporal_multiplier
             * trend_multiplier
             * competition_multiplier
```

Output: **Performance bucket** with confidence interval.

| Bucket | Definition |
|--------|-----------|
| Breakout (top 10%) | ER > creator's rolling 90d p90 |
| Above Average (10-35%) | ER between p65 and p90 |
| Average (35-65%) | ER between p35 and p65 |
| Below Average (65-100%) | ER below p35 |

### 3.2 Creator Baseline (30-40% of signal)

Computed from connected account history. Features:

- **Rolling engagement rate**: 30d/90d median ER, weighted by recency
- **Breakout rate**: `count(posts WHERE ER > rolling_30d_median * 2.0) / total_posts_90d`
- **Consistency score**: coefficient of variation of ER over 90d
- **Growth trajectory**: follower count slope over 30d/90d
- **Audience quality**: real demographics from Graph API (gender, age, city distribution)
- **Content cadence**: posts/week, time between posts
- **Niche authority**: category concentration ratio from post topics

**Scraped fallback** (no OAuth): Same features but from publicly visible metrics only (no saves, reach, impressions). Lower confidence, wider prediction intervals.

### 3.3 Content Multiplier (10-20% of signal)

12-dimension scoring via Gemini 2.5 Flash ($0.004/video):

| Dimension | Weight | Signal Source |
|-----------|--------|---------------|
| Hook strength (0-3s) | 0.15 | First frame analysis |
| Retention design | 0.12 | Pacing, pattern interrupts |
| Information density | 0.08 | Value-per-second ratio |
| Emotional trigger | 0.10 | Sentiment, surprise, humor |
| Production quality | 0.07 | Lighting, framing, audio |
| Trend leverage | 0.10 | Audio/format trend alignment |
| Brand integration | 0.08 | Organic vs forced placement |
| CTA effectiveness | 0.05 | Save/share prompt clarity |
| Audio fit | 0.07 | Trending audio, music-content match |
| Shareability | 0.08 | "Would you send this?" heuristic |
| Comment magnetism | 0.05 | Opinion-provoking elements |
| Niche authority | 0.05 | Domain expertise signals |

Content multiplier = weighted sum normalized to [0.5, 2.0] range around 1.0.

### 3.4 Temporal Multiplier (2-5% of signal)

Features encoded as sin/cos pairs for cyclicality:

- `hour_sin = sin(2*pi*hour/24)`, `hour_cos = cos(2*pi*hour/24)`
- `dow_sin = sin(2*pi*day/7)`, `dow_cos = cos(2*pi*day/7)`
- `month_sin = sin(2*pi*month/12)`, `month_cos = cos(2*pi*month/12)`
- Follower online-time overlap (from Graph API `online_followers` if available)
- Competition density: estimated posts/hour in same niche at post time

Temporal multiplier range: [0.85, 1.15]. Small effect, but consistent.

### 3.5 Trend Multiplier

Instagram's trend lifecycle (from research):

```
Emergence (0-24hr) -> Growth (24-48hr) -> Peak (48-72hr) -> Saturation (72hr+) -> Penalty
```

- **Trending audio detection**: Track audio usage velocity across scraped posts
- **Format trend detection**: Monitor visual pattern clusters (split-screen, POV, etc.)
- **Trend phase classification**: Early adopter (1.3-1.5x), Peak (1.0x), Late (0.7-0.8x)
- **72-hour exhaustion window**: After ~72hrs, trend alignment becomes neutral or negative

Trend multiplier range: [0.7, 1.5].

### 3.6 Competition Multiplier

- Estimated from posting volume in creator's niche at the target time
- Higher competition = lower distribution probability per post
- Derived from aggregated posting patterns across connected accounts in same category

Competition multiplier range: [0.9, 1.1]. Smallest individual effect.

## 4. Model Architecture

### 4.1 Algorithm: XGBoost (not deep learning)

Research finding: XGBoost outperforms deep learning for tabular engagement prediction (PR AUC 0.43 vs CLIP's 0.10). Deep learning only adds value for raw content features (video/image), which we handle separately via Gemini scoring.

**Feature vector** (per prediction):

```
creator_features:     [rolling_er_30d, rolling_er_90d, breakout_rate, consistency,
                       growth_slope, audience_quality_score, cadence,
                       follower_count_log, niche_concentration]       # 9 features

content_features:     [hook, retention, info_density, emotional_trigger,
                       production, trend_leverage, brand_integration,
                       cta, audio_fit, shareability, comment_magnetism,
                       niche_authority]                                 # 12 features

temporal_features:    [hour_sin, hour_cos, dow_sin, dow_cos,
                       month_sin, month_cos, competition_density,
                       follower_overlap_ratio]                         # 8 features

trend_features:       [trend_phase_score, audio_trend_velocity,
                       format_trend_match]                             # 3 features

cross_features:       [creator_category_x_hour,
                       content_quality_x_trend_phase,
                       follower_count_bucket_x_content_type]           # 3 features

TOTAL:                                                                  35 features
```

### 4.2 Output

```typescript
interface PredictionResult {
  bucket: 'breakout' | 'above_average' | 'average' | 'below_average';
  bucket_probability: number;        // P(actual bucket = predicted bucket)
  predicted_er_range: [number, number]; // 80% confidence interval
  predicted_er_median: number;
  confidence: 'high' | 'medium' | 'low';

  // Factor breakdown (for explainability)
  creator_baseline_er: number;
  content_multiplier: number;
  temporal_multiplier: number;
  trend_multiplier: number;
  competition_multiplier: number;

  // Actionable insights
  optimal_post_window: { start: string; end: string } | null;
  trend_alignment_score: number;
  improvement_suggestions: string[];  // Top 3 from content scoring
}
```

### 4.3 Real-Time Refinement (SEISMIC-inspired)

After posting, monitor early engagement signals:

| Time Window | What It Tells Us | Action |
|-------------|-----------------|--------|
| 0-30 min | Follower seed response | Refine bucket with 15% error |
| 30min-2hr | Non-follower test results | Update prediction, PR AUC ~0.65 |
| 2-6hr | Explore expansion signal | Near-final prediction |
| 6-24hr | Sustained distribution | Day-1 views predict Day-30 (SRC 0.959) |

Self-exciting point process: early engagement velocity predicts total reach with 15% error after just 1 hour.

## 5. Connected Account Data Pipeline

### 5.1 Instagram Graph API Access

**What we get** (Business/Creator accounts with 1000+ followers):

| Endpoint | Metrics | Rate Limit |
|----------|---------|------------|
| `GET /{media-id}/insights` | reach, impressions, saves, shares, plays, total_interactions | 200/hr/account |
| `GET /{user-id}/insights` | follower_count, impressions, reach, profile_views | 200/hr/account |
| `GET /{user-id}/media` | All public post data + timestamps | 200/hr/account |
| Audience demographics | audience_city, audience_gender_age, audience_country | 200/hr/account |

**Critical private metrics** (not available via scraping):
- **Saves**: Strongest signal of content value per Meta's own research
- **Shares/Sends**: 3-5x weight of likes in ranking (Mosseri, 2024)
- **Reach vs Impressions**: Shows algorithmic amplification ratio
- **Reels skip rate**: Direct retention quality signal
- **Audience demographics**: Real data, not inferred

### 5.2 Data Ingestion Schedule

Per connected account:
- **On connect**: Full history backfill (all available posts + insights)
- **Daily**: New posts + insights for posts < 7 days old
- **Weekly**: Audience demographics refresh + follower count
- **Post-publish**: Burst polling at 30min, 2hr, 6hr, 24hr for real-time refinement

Budget: 200 calls/hr per account. A full backfill of 100 posts = ~200 calls. Daily sync for active account = ~20 calls.

## 6. Phased Rollout

### Phase 1: Insights Engine (Day 1, no ML)

**What it does**: Dashboard showing creator performance analytics from connected accounts. No predictions yet.

**Value**: Brands see real engagement data, audience quality, content performance trends. Already more than what competitors show. Generates the connected-account data that trains Phase 2.

**Features**:
- Creator report card (ER trend, audience quality, best/worst performing content)
- Content library with actual engagement metrics
- Audience overlap analysis across shortlisted creators
- Breakout rate calculation per creator

**Data needed**: Just connected account data via Graph API.

### Phase 2: Calibrated Scoring (50+ connected accounts)

**What it does**: Global baseline model trained on aggregated data from all connected accounts. Content scoring via Gemini. Temporal features from posting patterns.

**Value**: "Your content will likely perform in the Above Average bucket for this creator" with confidence intervals.

**Features**:
- Pre-publish content scoring (12 dimensions)
- Creator-content fit score
- Optimal posting window suggestion
- Trend alignment indicator

**Data needed**: 50+ connected accounts with 30+ posts each = 1,500+ labeled examples.

### Phase 3: Full Prediction Engine (500+ connected accounts)

**What it does**: Per-creator calibrated models. Real-time refinement. Trend detection. Competition modeling.

**Value**: Reliable bucket predictions with narrow confidence intervals. Early engagement alerts. Automated optimization suggestions.

**Features**:
- All Phase 2 features with higher accuracy
- Real-time post monitoring with progressive prediction updates
- Trend detection and lifecycle tracking
- Cross-creator performance benchmarking within niches
- "What-if" simulator: test content against different creators/times

**Data needed**: 500+ accounts, 15,000+ labeled examples with private metrics.

## 7. Training Data Strategy

### 7.1 Bootstrapping from Existing Data

**Available now**:
- 2,032 curated creators with profile data (3 posts each)
- 100,000 leads with basic profiles
- Camoufox scraper that extracts 12 posts per profile with real captions, timestamps, engagement

**Scraping plan for baseline model**:
1. Run Camoufox scraper against 2,032 curated creators -> 12 posts each = ~24,000 posts
2. For top 500 creators (by follower count diversity), do 2-3 scrape passes over weeks to get temporal engagement snapshots
3. Score all scraped content via Gemini 2.5 Flash -> 12 dimensions per post
4. Build global baseline model from this data (public metrics only)

**Limitation**: Scraped data has no saves, reach, impressions, or skip rate. Baseline model will be less accurate than connected-account model. That's expected and honest.

### 7.2 Connected Account Training Loop

Once accounts connect:
1. Backfill full history with private metrics
2. Add to training set with `data_source: 'oauth'` flag
3. Retrain model nightly when new data arrives
4. Per-creator calibration layer after 30+ posts from same creator

### 7.3 Dataset Schema

```typescript
interface TrainingExample {
  // Identity
  creator_id: string;
  post_id: string;
  data_source: 'scraped' | 'oauth';

  // Target variable
  engagement_rate: number;
  performance_bucket: 'breakout' | 'above_average' | 'average' | 'below_average';

  // Creator features (at time of posting)
  creator_follower_count: number;
  creator_rolling_er_30d: number;
  creator_rolling_er_90d: number;
  creator_breakout_rate: number;
  creator_consistency: number;
  creator_growth_slope: number;
  creator_cadence: number;
  creator_category: string;
  creator_tier: string;

  // Content features (Gemini-scored)
  content_scores: Record<string, number>; // 12 dimensions

  // Temporal features
  posted_hour: number;
  posted_dow: number;
  posted_month: number;

  // Engagement (target decomposition)
  like_count: number;
  comment_count: number;
  view_count: number | null;
  save_count: number | null;       // null if scraped
  share_count: number | null;      // null if scraped
  reach: number | null;            // null if scraped
  impressions: number | null;      // null if scraped
}
```

## 8. API Surface

### 8.1 Pre-publish Prediction

```
POST /api/predict/content
Body: {
  creator_id: string,
  content_url?: string,       // uploaded video/image
  content_scores?: object,    // pre-computed Gemini scores
  target_post_time?: string,  // ISO timestamp
}
Response: PredictionResult
```

### 8.2 Real-time Monitoring

```
POST /api/predict/monitor
Body: {
  post_url: string,
  creator_id: string,
}
Response: SSE stream of PredictionResult updates at 30min, 2hr, 6hr, 24hr
```

### 8.3 Optimal Timing

```
POST /api/predict/optimal-time
Body: {
  creator_id: string,
  content_scores: object,
  date_range: { start: string, end: string },
}
Response: {
  windows: Array<{ start: string, end: string, predicted_multiplier: number }>,
  best_window: { start: string, end: string },
}
```

## 9. Tech Stack Additions

| Component | Technology | Why |
|-----------|-----------|-----|
| ML model training | Python + XGBoost | Best for tabular data, proven in engagement prediction |
| Content scoring | Gemini 2.5 Flash API | $0.004/video, 12-dimension scoring |
| Feature store | PostgreSQL + materialized views | Already in stack, no new infra |
| Model serving | Python FastAPI microservice | Lightweight, easy to deploy |
| Real-time monitoring | Node.js worker (existing infra) | Polling Graph API on schedule |
| Training pipeline | Python scripts, cron-triggered | Simple, debuggable |

## 10. Cold-Start Handling

| Creator Data Available | Strategy | Confidence |
|----------------------|----------|------------|
| Connected + 30 posts | Per-creator calibrated model | High |
| Connected + <30 posts | Global model + creator features as input | Medium |
| Scraped only (12 posts) | Global model, public metrics only | Low |
| No history (new creator) | Content scoring only, no bucket prediction | Very Low — show scores, not buckets |

When confidence is Low or Very Low, the UI shows content scores and creator metrics but explicitly states "Not enough data for reliable performance prediction." No fake confidence.

## 11. What We're NOT Building

- **Follower prediction**: Not the same problem, not our value prop
- **Competitor intelligence**: Scraping competitors' private data is impossible
- **Automated posting**: We predict, humans/tools decide when to post
- **Content generation**: We score existing content, not create new content
- **Fake engagement detection**: Handled by existing credibility scoring
- **Cross-platform prediction**: Instagram only for v1

## 11. Success Metrics

| Metric | Phase 1 Target | Phase 2 Target | Phase 3 Target |
|--------|---------------|---------------|---------------|
| Connected accounts | 10 | 50 | 500 |
| Bucket prediction accuracy | N/A | 55% | 70% |
| Breakout recall | N/A | 40% | 60% |
| Mean prediction interval width | N/A | 3x | 1.5x |
| Time to prediction (pre-publish) | N/A | <5s | <5s |
| Brand retention lift vs control | +10% | +25% | +40% |
