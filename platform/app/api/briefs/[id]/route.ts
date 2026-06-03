import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type {
  Brief,
  BriefCreator,
  Creator,
  ShortlistCreatorView,
} from '@influencer-intel/shared/types';
import { freshnessBadge } from '@/lib/freshness';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getBolticClient();

  const brief = await db.findById<Brief>('briefs', id);
  if (!brief) return NextResponse.json({ error: 'brief not found' }, { status: 404 });

  const briefCreators = await db.query<BriefCreator>(
    `SELECT * FROM brief_creators WHERE brief_id = $1 ORDER BY rank ASC`,
    [id],
  );

  // Pending = on_demand or refresh scrapes still running for this brief.
  // search_query jobs don't count — they only enqueue follow-up work, they
  // don't add creators to the shortlist directly.
  const pendingRows = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM scrape_jobs
     WHERE brief_id = $1
       AND job_type IN ('on_demand', 'refresh', 'search_query')
       AND status IN ('queued', 'in_progress')`,
    [id],
  );
  const pending_count = pendingRows[0]?.count ?? 0;

  const creatorIds = briefCreators.map((bc) => bc.creator_id);
  const creators = creatorIds.length === 0
    ? []
    : await db.query<Creator>(`SELECT * FROM creators WHERE id = ANY($1)`, [creatorIds]);
  const creatorMap = new Map(creators.map((c) => [c.id, c]));

  const ui: ShortlistCreatorView[] = [];
  for (const bc of briefCreators) {
    const creator = creatorMap.get(bc.creator_id);
    if (!creator) continue;
    const item: ShortlistCreatorView = {
      brief_creator_id: bc.id,
      creator: {
        id: creator.id,
        handle: creator.handle,
        platform: creator.platform,
        display_name: creator.display_name,
        profile_photo_url: creator.profile_photo_url,
        follower_count: creator.follower_count,
        following_count: creator.following_count,
        posts_count: creator.posts_count,
        engagement_rate: creator.engagement_rate,
        primary_city: creator.primary_city,
        primary_category: creator.primary_category,
        content_languages: creator.content_languages,
        data_tier: creator.data_tier,
        is_verified: creator.is_verified,
        is_indian: creator.is_indian,
        bio: creator.bio,
      },
      match_score: bc.match_score,
      rank: bc.rank,
      reasoning: bc.reasoning,
      freshness: (bc.freshness as ShortlistCreatorView['freshness']) ?? freshnessBadge(creator),
      raw_metadata: creator.raw_metadata,
    };
    if (creator.credibility) {
      item.credibility = {
        overall_score: creator.credibility.overall_score,
        badge: creator.credibility.badge,
        signals: creator.credibility.signals,
        flags: creator.credibility.flags,
      };
    }
    if (creator.audience_demographics) {
      item.audience = {
        confidence: creator.audience_demographics.confidence,
        gender_female_pct: creator.audience_demographics.gender.female_pct,
        top_cities: creator.audience_demographics.top_cities,
      };
    }
    ui.push(item);
  }

  return NextResponse.json({ brief, creators: ui, pending_count });
}
