// ============================================================
// Campaign analytics — aggregates campaigns + recorded outcomes for the
// /analytics dashboard.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

export interface AnalyticsTotals {
  campaigns: number;
  creators: number;
  reach: number;
  spend: number;
  avg_quality: number;
}
export interface CampaignPerf {
  id: string;
  name: string;
  status: string;
  recruits: number;
  reach: number;
  spend: number;
}
export interface OutcomeRow {
  id: string;
  name: string | null;
  handle: string | null;
  predicted_likes: number | null;
  actual_likes: number | null;
  predicted_views: number | null;
  actual_views: number | null;
  created_at: string;
}

export type Period = '7d' | '30d' | '90d' | 'all';

function cutoffISO(period: Period): string {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null;
  if (days == null) return '1970-01-01T00:00:00.000Z';
  return new Date(Date.now() - days * 86400000).toISOString();
}

export async function getAnalytics(period: Period = 'all'): Promise<{
  totals: AnalyticsTotals;
  per_campaign: CampaignPerf[];
  outcomes: OutcomeRow[];
  period: Period;
}> {
  const db = getBolticClient();
  const cut = cutoffISO(period);

  const totalsRows = await db.query<AnalyticsTotals>(
    `SELECT
       (SELECT COUNT(*)::int FROM programs WHERE created_at >= $1) AS campaigns,
       (SELECT COUNT(DISTINCT pr.creator_id)::int
          FROM program_recruits pr JOIN programs p ON p.id = pr.program_id
          WHERE pr.status <> 'declined' AND p.created_at >= $1) AS creators,
       (SELECT COALESCE(SUM(c.follower_count), 0)::float
          FROM (SELECT DISTINCT pr.creator_id FROM program_recruits pr JOIN programs p ON p.id = pr.program_id
                WHERE pr.status <> 'declined' AND p.created_at >= $1) d
          JOIN creators c ON c.id = d.creator_id) AS reach,
       (SELECT COALESCE(SUM(pr.rate), 0)::float
          FROM program_recruits pr JOIN programs p ON p.id = pr.program_id
          WHERE pr.status <> 'declined' AND p.created_at >= $1) AS spend,
       (SELECT COALESCE(AVG(c.quality_score), 0)::float
          FROM (SELECT DISTINCT pr.creator_id FROM program_recruits pr JOIN programs p ON p.id = pr.program_id
                WHERE pr.status <> 'declined' AND p.created_at >= $1) d
          JOIN creators c ON c.id = d.creator_id
          WHERE c.quality_score IS NOT NULL) AS avg_quality`,
    [cut],
  );

  const per_campaign = await db.query<CampaignPerf>(
    `SELECT p.id, p.name, p.status,
            COUNT(pr.id) FILTER (WHERE pr.status <> 'declined')::int AS recruits,
            COALESCE(SUM(c.follower_count) FILTER (WHERE pr.status <> 'declined'), 0)::float AS reach,
            COALESCE(SUM(pr.rate) FILTER (WHERE pr.status <> 'declined'), 0)::float AS spend
     FROM programs p
     LEFT JOIN program_recruits pr ON pr.program_id = p.id
     LEFT JOIN creators c ON c.id = pr.creator_id
     WHERE p.created_at >= $1
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [cut],
  );

  const outcomes = await db.query<OutcomeRow>(
    `SELECT po.id, c.display_name AS name, c.handle,
            po.predicted_likes, po.actual_likes, po.predicted_views, po.actual_views, po.created_at
     FROM post_outcomes po
     JOIN creators c ON c.id = po.creator_id
     WHERE po.created_at >= $1
     ORDER BY po.created_at DESC
     LIMIT 20`,
    [cut],
  );

  return { totals: totalsRows[0]!, per_campaign, outcomes, period };
}
