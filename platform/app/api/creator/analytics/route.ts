import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph';
import { getAccessToken } from '@/lib/oauth-service';
import type { ConnectedAccount } from '@influencer-intel/shared/types';
import type { IGMedia } from '@influencer-intel/shared/ig-graph/types';
import { forecastReels, contentBreakdown } from '@/lib/reel-forecast';
import { audienceQuality } from '@/lib/audience-quality';
import { analyzeContent } from '@/lib/content-analysis';
import { analyzeCaptions } from '@/lib/caption-analysis';
import { computeBenchmark, tierLabel, tierWindow } from '@/lib/peer-benchmark';
import type { PeerBenchmark } from '@/lib/peer-benchmark';
import { estimateMediaValue } from '@/lib/media-value';
import { suggestRateCard } from '@/lib/media-kit';
import { generatePitchCoach } from '@/lib/pitch-coach';
import { analyzePostingTime } from '@/lib/posting-time';
import { analyzeFormatTiming } from '@/lib/format-timing';
import { generateContentPlaybook } from '@/lib/content-playbook';
import { generateContentIdeas } from '@/lib/content-ideas';
import { analyzeAudience } from '@/lib/audience-insights';
import { projectGrowth } from '@/lib/growth-projection';
import { analyzeEngagementTrend } from '@/lib/engagement-trend';
import { generatePitchDraft } from '@/lib/pitch-draft';
import { generateRecommendations } from '@/lib/recommendations';

export const runtime = 'nodejs';
export const maxDuration = 60;

// How many recent posts to enrich with per-media insights (reach/plays/saves).
// Bounded so we stay well inside the Graph rate budget for a live request.
const INSIGHTS_CAP = 18;
const MEDIA_CAP = 24;

interface AnalyticsPost {
  id: string;
  shortcode: string;
  permalink: string;
  media_type: string;
  thumbnail_url: string | null;
  media_url: string | null;
  caption: string | null;
  timestamp: string;
  like_count: number;
  comments_count: number;
  er: number | null;
  reach: number | null;
  plays: number | null;
  saved: number | null;
  shares: number | null;
}

/**
 * GET /api/creator/analytics?account=<id>|?handle=<h>
 *
 * Live-fetches a connected creator's Instagram analytics straight from the
 * Graph API (no dependency on the sync worker having run). Returns a
 * self-contained dashboard payload. Always 200 — `connected:false` carries a
 * friendly reason so the preview page can render an empty state.
 *
 * NOTE: not yet wired into platform nav/login — feeds the standalone
 * /creator/analytics-preview page only.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '') ?? null;

  const db = getBolticClient();

  // Resolve which connected account to load: explicit id > handle > most recent.
  let account: ConnectedAccount | null = null;
  try {
    if (accountId) {
      const rows = await db.query<ConnectedAccount>(
        `SELECT * FROM connected_accounts WHERE id = $1 LIMIT 1`, [accountId],
      );
      account = rows[0] ?? null;
    } else if (handle) {
      const rows = await db.query<ConnectedAccount>(
        `SELECT ca.* FROM connected_accounts ca
         JOIN creators c ON c.id = ca.creator_id
         WHERE c.handle = $1 AND ca.connection_status = 'active'
         ORDER BY ca.connected_at DESC LIMIT 1`, [handle],
      );
      account = rows[0] ?? null;
    } else {
      const rows = await db.query<ConnectedAccount>(
        `SELECT * FROM connected_accounts WHERE connection_status = 'active'
         ORDER BY connected_at DESC LIMIT 1`,
      );
      account = rows[0] ?? null;
    }
  } catch (err) {
    return NextResponse.json(
      { connected: false, reason: 'db_error', error: (err as Error).message },
      { status: 200 },
    );
  }

  if (!account) {
    return NextResponse.json(
      { connected: false, reason: 'no_account' },
      { status: 200 },
    );
  }

  try {
    const token = await getAccessToken(account.id);
    const client = new IGGraphClient(token);

    const profile = await client.getProfile();
    const followers = profile.followers_count ?? 0;

    // Record today's follower snapshot (one row per account per day) so the
    // dashboard can chart growth over time. Best-effort — never blocks the
    // response. IG only gives us the current count, so history accrues here.
    let growth: { date: string; followers: number }[] = [];
    try {
      await db.query(
        `INSERT INTO follower_snapshots
           (connected_account_id, creator_id, followers_count, follows_count, media_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (connected_account_id, captured_on) DO UPDATE SET
           followers_count = EXCLUDED.followers_count,
           follows_count   = EXCLUDED.follows_count,
           media_count     = EXCLUDED.media_count,
           captured_at     = NOW()`,
        [account.id, account.creator_id, profile.followers_count ?? null,
          profile.follows_count ?? null, profile.media_count ?? null],
      );
      const snaps = await db.query<{ captured_on: string; followers_count: number | string }>(
        `SELECT captured_on, followers_count FROM follower_snapshots
         WHERE connected_account_id = $1 AND followers_count IS NOT NULL
         ORDER BY captured_on ASC LIMIT 90`,
        [account.id],
      );
      growth = snaps.map((s) => ({
        date: typeof s.captured_on === 'string' ? s.captured_on.slice(0, 10)
          : new Date(s.captured_on).toISOString().slice(0, 10),
        followers: Number(s.followers_count),
      }));
    } catch {
      growth = [];
    }

    const media: IGMedia[] = await client.getAllMedia(MEDIA_CAP);

    // Enrich the most recent posts with per-media insights (reach/plays/etc).
    const toEnrich = media.slice(0, INSIGHTS_CAP);
    const insightsResults = await Promise.allSettled(
      toEnrich.map((m) => client.getMediaInsights(m.id, m.media_type)),
    );
    const insightsById = new Map<string, Record<string, number>>();
    toEnrich.forEach((m, i) => {
      const r = insightsResults[i];
      if (r && r.status === 'fulfilled') {
        const map: Record<string, number> = {};
        for (const item of r.value.data) map[item.name] = item.values[0]?.value ?? 0;
        insightsById.set(m.id, map);
      }
    });

    const posts: AnalyticsPost[] = media.map((m) => {
      const ins = insightsById.get(m.id);
      const likes = m.like_count ?? ins?.likes ?? 0;
      const comments = m.comments_count ?? ins?.comments ?? 0;
      const er = followers > 0 ? (likes + comments) / followers : null;
      return {
        id: m.id,
        shortcode: m.shortcode,
        permalink: m.permalink,
        media_type: m.media_type,
        thumbnail_url: m.thumbnail_url ?? null,
        media_url: m.media_url ?? null,
        caption: m.caption ?? null,
        timestamp: m.timestamp,
        like_count: likes,
        comments_count: comments,
        er,
        reach: ins?.reach ?? null,
        plays: ins?.plays ?? null,
        saved: ins?.saved ?? null,
        shares: ins?.shares ?? null,
      };
    });

    // ---- Derived aggregate stats -------------------------------------------
    const enriched = posts.slice(0, INSIGHTS_CAP);
    const avg = (nums: number[]): number | null =>
      nums.length ? Math.round(nums.reduce((s, v) => s + v, 0) / nums.length) : null;

    const reels = enriched.filter((p) => p.media_type === 'VIDEO' || p.media_type === 'REELS');
    const images = enriched.filter((p) => p.media_type !== 'VIDEO' && p.media_type !== 'REELS');
    const ers = enriched.map((p) => p.er).filter((v): v is number => v != null);

    const stats = {
      posts_analyzed: enriched.length,
      total_media: profile.media_count ?? media.length,
      avg_likes: avg(enriched.map((p) => p.like_count)),
      avg_comments: avg(enriched.map((p) => p.comments_count)),
      avg_er: ers.length ? ers.reduce((s, v) => s + v, 0) / ers.length : null,
      reels_count: reels.length,
      images_count: images.length,
      avg_reel_plays: avg(reels.map((p) => p.plays ?? 0).filter((v) => v > 0)),
      avg_reach: avg(enriched.map((p) => p.reach ?? 0).filter((v) => v > 0)),
    };

    // ---- Posting cadence ----------------------------------------------------
    const ts = media
      .map((m) => new Date(m.timestamp).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    let posts_per_week: number | null = null;
    let avg_days_between_posts: number | null = null;
    if (ts.length >= 2) {
      const spanMs = ts[0]! - ts[ts.length - 1]!;
      const weeks = spanMs / (7 * 86400000);
      if (weeks > 0) posts_per_week = Math.round((ts.length / weeks) * 10) / 10;
      const gaps: number[] = [];
      for (let i = 0; i < ts.length - 1; i++) gaps.push((ts[i]! - ts[i + 1]!) / 86400000);
      avg_days_between_posts = Math.round((gaps.reduce((s, v) => s + v, 0) / gaps.length) * 10) / 10;
    }

    // ---- Audience demographics ---------------------------------------------
    let demographics: {
      gender_age: Record<string, number>;
      cities: Record<string, number>;
      countries: Record<string, number>;
    } | null = null;
    try {
      demographics = await client.getAudienceDemographics();
    } catch {
      demographics = null;
    }

    // ---- Peer benchmarking --------------------------------------------------
    // Rank this creator's engagement against similar-tier (and, if the sample
    // is big enough, same-niche) creators already in our DB. Best-effort.
    let benchmark: PeerBenchmark | null = null;
    let niche: string | null = null;   // creator's niche, hoisted for reuse below
    try {
      if (followers > 0 && stats.avg_er != null && stats.avg_er > 0) {
        const { lo, hi } = tierWindow(followers);
        // The creator's own niche (category first, vision niche fallback).
        const nicheRows = await db.query<{ primary_category: string | null; vision_niche: string | null }>(
          `SELECT primary_category, raw_metadata->'vision'->>'niche' AS vision_niche
             FROM creators WHERE id = $1 LIMIT 1`,
          [account.creator_id],
        );
        const nicheRaw = (nicheRows[0]?.primary_category ?? nicheRows[0]?.vision_niche ?? '').trim().toLowerCase();
        const nicheLabel = nicheRaw || null;
        niche = nicheLabel;

        // Same-tier cohort (excluding self), ER as a fraction.
        const tierRows = await db.query<{ engagement_rate: number | string }>(
          `SELECT engagement_rate FROM creators
            WHERE engagement_rate IS NOT NULL AND engagement_rate > 0
              AND follower_count BETWEEN $1 AND $2
              AND id <> $3`,
          [lo, hi, account.creator_id],
        );
        const tierErs = tierRows.map((r) => Number(r.engagement_rate)).filter((v) => Number.isFinite(v) && v > 0);

        // Same-tier + same-niche cohort.
        let nicheErs: number[] = [];
        if (nicheLabel) {
          const nicheRowsC = await db.query<{ engagement_rate: number | string }>(
            `SELECT engagement_rate FROM creators
              WHERE engagement_rate IS NOT NULL AND engagement_rate > 0
                AND follower_count BETWEEN $1 AND $2
                AND id <> $3
                AND (LOWER(primary_category) = $4 OR LOWER(raw_metadata->'vision'->>'niche') = $4)`,
            [lo, hi, account.creator_id, nicheLabel],
          );
          nicheErs = nicheRowsC.map((r) => Number(r.engagement_rate)).filter((v) => Number.isFinite(v) && v > 0);
        }

        benchmark = computeBenchmark({
          your_er: stats.avg_er,
          tier_label: tierLabel(followers),
          niche_label: nicheLabel,
          tier_ers: tierErs,
          niche_ers: nicheErs,
        });
      }
    } catch {
      benchmark = null;
    }

    // Predictive + depth analyses, computed from the posts we already enriched
    // with insights (no extra Graph calls).
    const reelForecast = forecastReels(enriched);
    const contentBreak = contentBreakdown(enriched);
    const audQuality = audienceQuality(followers, enriched);
    const contentAnalysis = analyzeContent(enriched);
    const captionAnalysis = analyzeCaptions(enriched);
    // Best-time analysis uses ALL fetched posts (more timestamps = better).
    const postingTime = analyzePostingTime(posts.map((p) => ({ timestamp: p.timestamp, er: p.er })));
    // Format × timing grid — which format wins in which posting window.
    const formatTiming = analyzeFormatTiming(
      posts.map((p) => ({ media_type: p.media_type, timestamp: p.timestamp, er: p.er })),
    );
    // Overall engagement momentum across every format (not just reels).
    const engagementTrend = analyzeEngagementTrend(posts.map((p) => ({ timestamp: p.timestamp, er: p.er })));
    // Prescriptive "next 3 posts" plan, synthesised from the above signals.
    const contentPlaybook = generateContentPlaybook({
      content_breakdown: contentBreak,
      reel_forecast: reelForecast,
      content_analysis: contentAnalysis,
      caption_analysis: captionAnalysis,
      posting_time: postingTime,
    });
    // Ready-to-shoot idea variations off the winning format + topic.
    const contentIdeas = generateContentIdeas({
      best_type: contentBreak.best_type,
      niche,
      top_hashtag: contentAnalysis.hashtags?.[0]?.tag ?? null,
      caption_best_length: captionAnalysis.available ? captionAnalysis.best_length : null,
    });
    // Whole-audience profile narrative from the demographics blob.
    const audienceInsights = analyzeAudience(demographics);
    // Forward follower-growth projection from the snapshot history.
    const growthProjection = projectGrowth(growth, followers);

    // Earned media value — from the same enriched posts + cadence.
    const avgOf = (nums: number[]): number | null =>
      nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
    const savesVals = enriched.map((p) => p.saved ?? 0).filter((v) => v > 0);
    const sharesVals = enriched.map((p) => p.shares ?? 0).filter((v) => v > 0);
    const mediaValue = estimateMediaValue({
      followers,
      avg_reach: stats.avg_reach,
      avg_likes: stats.avg_likes,
      avg_comments: stats.avg_comments,
      avg_saves: avgOf(savesVals),
      avg_shares: avgOf(sharesVals),
      posts_per_week,
    });

    // Pitch coach — synthesises the money + performance signals into a
    // negotiation cheat-sheet. Rate card is computed here to anchor the ask.
    const rateCard = suggestRateCard(followers, stats.avg_er);
    const pitchCoach = generatePitchCoach({
      followers,
      tier_label: tierLabel(followers),
      avg_er: stats.avg_er,
      media_value: mediaValue,
      benchmark,
      audience_quality: audQuality,
      content_breakdown: contentBreak,
      rate_card: rateCard,
      posts_per_week,
    });

    // Copy-ready pitch message — turns the numbers above into an outreach
    // email/DM the creator can paste, tweak a couple of {placeholders}, and send.
    const pitchDraft = generatePitchDraft({
      name: profile.name ?? null,
      handle: profile.username ?? null,
      tier_label: tierLabel(followers),
      niche,
      followers,
      avg_er: stats.avg_er,
      media_value: mediaValue,
      benchmark,
      content_breakdown: contentBreak,
      posts_per_week,
    });

    // Saves + shares share of interactions — feeds a recommendation.
    const interTotals = enriched.reduce(
      (a, p) => {
        a.total += (p.like_count || 0) + (p.comments_count || 0) + (p.saved ?? 0) + (p.shares ?? 0);
        a.sv += (p.saved ?? 0) + (p.shares ?? 0);
        return a;
      },
      { total: 0, sv: 0 },
    );
    const savesSharesPct = interTotals.total > 0 ? Math.round((interTotals.sv / interTotals.total) * 100) : null;

    const recommendations = generateRecommendations({
      content_breakdown: contentBreak,
      reel_forecast: reelForecast,
      content_analysis: contentAnalysis,
      audience_quality: audQuality,
      caption_analysis: captionAnalysis,
      benchmark,
      posting_time: postingTime,
      posts_per_week,
      saves_shares_pct: savesSharesPct,
    });

    return NextResponse.json({
      connected: true,
      account: {
        id: account.id,
        ig_username: account.ig_username,
        connected_at: account.connected_at,
        token_expires_at: account.token_expires_at,
        connection_status: account.connection_status,
      },
      profile: {
        username: profile.username,
        name: profile.name ?? null,
        biography: profile.biography ?? null,
        followers_count: profile.followers_count ?? null,
        follows_count: profile.follows_count ?? null,
        media_count: profile.media_count ?? null,
        profile_picture_url: profile.profile_picture_url ?? null,
        website: profile.website ?? null,
      },
      stats,
      cadence: { posts_per_week, avg_days_between_posts },
      growth,
      recommendations,
      reel_forecast: reelForecast,
      content_breakdown: contentBreak,
      audience_quality: audQuality,
      content_analysis: contentAnalysis,
      caption_analysis: captionAnalysis,
      benchmark,
      media_value: mediaValue,
      pitch_coach: pitchCoach,
      pitch_draft: pitchDraft,
      posting_time: postingTime,
      format_timing: formatTiming,
      content_playbook: contentPlaybook,
      content_ideas: contentIdeas,
      audience_insights: audienceInsights,
      growth_projection: growthProjection,
      engagement_trend: engagementTrend,
      posts,
      demographics,
    });
  } catch (err) {
    // Token expired, insufficient permissions, or IG API error.
    return NextResponse.json(
      { connected: false, reason: 'fetch_error', error: (err as Error).message },
      { status: 200 },
    );
  }
}
