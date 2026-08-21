import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { TrendSignal } from '@influencer-intel/shared/types';
import { isMeaningfulTrend, byTrendRelevance } from '@/lib/trend-quality';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const phase = url.searchParams.get('phase');
  const category = url.searchParams.get('category');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);

  const db = getBolticClient();
  let whereClause = 'WHERE 1=1';
  const queryParams: unknown[] = [];

  if (phase) {
    queryParams.push(phase);
    whereClause += ` AND phase = $${queryParams.length}`;
  }
  if (category) {
    queryParams.push(category);
    whereClause += ` AND $${queryParams.length} = ANY(categories)`;
  }

  // Over-fetch by volume, then drop engagement-bait / geo / spam hashtags and
  // rank by real 7-day usage so the board shows trends worth acting on — not a
  // wall of obscure count-9 tags that only rank high because an empty prior
  // window inflates their velocity.
  const rows = await db.query<TrendSignal>(
    `SELECT * FROM trend_signals ${whereClause} ORDER BY usage_count_7d DESC, velocity DESC LIMIT ${Math.min(limit * 5, 250)}`,
    queryParams,
  );
  const trends = rows.filter(isMeaningfulTrend).sort(byTrendRelevance).slice(0, limit);

  return NextResponse.json({ trends, total: trends.length });
}
