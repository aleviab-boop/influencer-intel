// ============================================================
// Shortlist service — drives the brief→shortlist flow.
//   1. Embed the brief (if not already)
//   2. Discover candidates (cached + LLM-generated)
//   3. Bucket into fresh / stale / miss
//   4. Rank fresh creators → preliminary brief_creators rows
//   5. Queue scrape jobs for stale + miss
// On scrape callback, reRankAfterScrape() refreshes brief_creators.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type {
  Brief,
  BriefCreator,
  Creator,
  ShortlistCreatorView,
} from '@influencer-intel/shared/types';
import { discoverCandidates } from './discovery';
import { buildHashtagQueries } from './hashtag-discovery';
import { rankCreators, type RankedCreator } from './ranker';
import { generateLightReasoning, generatePerCreatorReasoning } from './reasoning';
import { freshnessBadge } from './freshness';
import { getBroadcaster } from './sse-broadcaster';

export const PRELIMINARY_TARGET_SIZE = 28;

export async function startShortlistGeneration(brief: Brief): Promise<{
  preliminary: ShortlistCreatorView[];
  pending_count: number;
}> {
  const db = getBolticClient();

  // Ensure brief has an embedding
  if (!brief.brief_embedding) {
    const llm = getOpenAIClient();
    const summary = [
      brief.raw_text,
      brief.parsed_spec?.category ?? '',
      (brief.parsed_spec?.target_cities ?? []).join(' '),
      (brief.parsed_spec?.target_languages ?? []).join(' '),
    ].join(' ');
    const embedding = await llm.embed(summary);
    await db.update('briefs', { id: brief.id }, { brief_embedding: embedding });
    brief.brief_embedding = embedding;
  }

  const buckets = await discoverCandidates(brief);
  const ranked = rankCreators(brief, buckets.fresh);
  const top = ranked.slice(0, PRELIMINARY_TARGET_SIZE);

  // Wipe any prior brief_creators for this brief (idempotent re-run)
  await db.query(`DELETE FROM brief_creators WHERE brief_id = $1`, [brief.id]);

  const inserted: BriefCreator[] = [];
  for (let i = 0; i < top.length; i++) {
    const r = top[i]!;
    const reasoning = generateLightReasoning(r, i + 1);
    const row = await db.insert<BriefCreator>('brief_creators', {
      brief_id: brief.id,
      brand_id: brief.brand_id,
      creator_id: r.creator.id,
      rank: i + 1,
      match_score: r.match_score,
      reasoning,
      freshness: freshnessBadge(r.creator),
    });
    inserted.push(row);
  }

  // Queue IG search-bar discovery jobs — these hit IG's own topsearch
  // endpoint from the authenticated Playwright session and return REAL,
  // IG-ranked users matching the query. Way better than LLM-hallucinated
  // handles. Each search result gets a stub creator row + on_demand
  // profile scrape queued behind it.
  const queries = await buildHashtagQueries(brief);
  for (const q of queries) {
    await db.insert('scrape_jobs', {
      job_type: 'search_query',
      target_platform: 'instagram',
      target_handle: q,
      brief_id: brief.id,
      // Search runs first — it surfaces the candidates that on_demand jobs
      // depend on. Priority 0 jumps ahead of brand-driven on_demand (1).
      priority: 0,
      status: 'queued',
      attempts: 0,
      requested_by_brand: brief.brand_id,
      queued_at: new Date().toISOString(),
    });
  }

  // Queue scrape jobs for stale + miss
  for (const stale of buckets.stale) {
    await db.insert('scrape_jobs', {
      job_type: 'refresh',
      target_platform: stale.platform,
      target_handle: stale.handle,
      creator_id: stale.id,
      brief_id: brief.id,
      priority: 2,
      status: 'queued',
      attempts: 0,
      requested_by_brand: brief.brand_id,
      queued_at: new Date().toISOString(),
    });
  }
  for (const miss of buckets.miss) {
    await db.insert('scrape_jobs', {
      job_type: 'on_demand',
      target_platform: 'instagram',
      target_handle: miss.handle,
      creator_id: null,
      brief_id: brief.id,
      priority: 1,
      status: 'queued',
      attempts: 0,
      requested_by_brand: brief.brand_id,
      queued_at: new Date().toISOString(),
    });
  }

  await db.update('briefs', { id: brief.id }, { status: 'shortlisted' });

  const preliminary = top.map((r, i) => toUI(r, inserted[i]!));

  // Emit preliminary event
  getBroadcaster().emit(brief.id, {
    type: 'preliminary',
    brief_id: brief.id,
    creators: preliminary,
    pending_count: buckets.stale.length + buckets.miss.length,
  });

  // Kick off rich LLM reasoning for the top creators in the background.
  // Don't block the response — UI shows light reasoning instantly, rich
  // reasoning streams in over the next 30-60s.
  void enrichReasoningInBackground(brief, top.slice(0, 12), inserted);

  return {
    preliminary,
    pending_count: buckets.stale.length + buckets.miss.length,
  };
}

/**
 * Generate LLM-quality per-creator reasoning paragraphs and update the
 * brief_creators rows. Fires as fire-and-forget after preliminary so the
 * brand sees the shortlist instantly and richer text fills in shortly.
 */
async function enrichReasoningInBackground(
  brief: Brief,
  ranked: RankedCreator[],
  inserted: BriefCreator[],
): Promise<void> {
  const db = getBolticClient();
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]!;
    const bc = inserted[i]!;
    try {
      const richReasoning = await generatePerCreatorReasoning(brief, r, i + 1);
      if (richReasoning && richReasoning.length > 20) {
        await db.update('brief_creators', { id: bc.id }, { reasoning: richReasoning });
      }
    } catch (err) {
      console.warn(`[reasoning] failed for #${i + 1} @${r.creator.handle}:`, (err as Error).message);
    }
  }
  // Notify UI so it re-fetches the brief and shows the richer text.
  getBroadcaster().emit(brief.id, {
    type: 'reranked',
    brief_id: brief.id,
    ordered_brief_creator_ids: inserted.map((bc) => bc.id),
  });
}

export function toUI(ranked: RankedCreator, briefCreator: BriefCreator): ShortlistCreatorView {
  const c = ranked.creator;
  const view: ShortlistCreatorView = {
    brief_creator_id: briefCreator.id,
    creator: {
      id: c.id,
      handle: c.handle,
      platform: c.platform,
      display_name: c.display_name,
      profile_photo_url: c.profile_photo_url,
      follower_count: c.follower_count,
      following_count: c.following_count,
      posts_count: c.posts_count,
      engagement_rate: c.engagement_rate,
      primary_city: c.primary_city,
      primary_category: c.primary_category,
      content_languages: c.content_languages,
      data_tier: c.data_tier,
      is_verified: c.is_verified,
      is_indian: c.is_indian,
      bio: c.bio,
    },
    match_score: ranked.match_score,
    rank: briefCreator.rank,
    reasoning: briefCreator.reasoning,
    freshness: (briefCreator.freshness as ShortlistCreatorView['freshness']) ?? freshnessBadge(c),
    raw_metadata: c.raw_metadata,
  };
  if (c.credibility) {
    view.credibility = {
      overall_score: c.credibility.overall_score,
      badge: c.credibility.badge,
      signals: c.credibility.signals,
      flags: c.credibility.flags,
    };
  }
  if (c.audience_demographics) {
    view.audience = {
      confidence: c.audience_demographics.confidence,
      gender_female_pct: c.audience_demographics.gender.female_pct,
      top_cities: c.audience_demographics.top_cities,
    };
  }
  return view;
}

/**
 * Called after a scrape completes — re-runs discovery for the brief
 * and replaces brief_creators with the latest ranking.
 */
export async function reRankAfterScrape(args: {
  brief_id: string;
  newly_scraped_creator_id: string | null;
}): Promise<void> {
  const db = getBolticClient();
  const brief = await db.findById<Brief>('briefs', args.brief_id);
  if (!brief) return;

  const buckets = await discoverCandidates(brief);
  const all = [...buckets.fresh];
  if (args.newly_scraped_creator_id) {
    const newCreator = await db.findById<Creator>('creators', args.newly_scraped_creator_id);
    if (newCreator && !all.some((c) => c.id === newCreator.id)) all.push(newCreator);
  }

  const ranked = rankCreators(brief, all);
  const top = ranked.slice(0, PRELIMINARY_TARGET_SIZE);

  await db.query(`DELETE FROM brief_creators WHERE brief_id = $1`, [args.brief_id]);
  const inserted: BriefCreator[] = [];
  for (let i = 0; i < top.length; i++) {
    const r = top[i]!;
    const row = await db.insert<BriefCreator>('brief_creators', {
      brief_id: args.brief_id,
      brand_id: brief.brand_id,
      creator_id: r.creator.id,
      rank: i + 1,
      match_score: r.match_score,
      reasoning: generateLightReasoning(r, i + 1),
      freshness: freshnessBadge(r.creator),
    });
    inserted.push(row);
  }

  const ui = top.map((r, i) => toUI(r, inserted[i]!));
  const broadcaster = getBroadcaster();
  broadcaster.emit(args.brief_id, {
    type: 'reranked',
    brief_id: args.brief_id,
    ordered_brief_creator_ids: ui.map((u) => u.brief_creator_id),
  });
  if (args.newly_scraped_creator_id) {
    const added = ui.find((u) => u.creator.id === args.newly_scraped_creator_id);
    if (added) {
      broadcaster.emit(args.brief_id, {
        type: 'creator_added',
        brief_id: args.brief_id,
        creator: added,
        rank: added.rank,
      });
    }
  }
}
