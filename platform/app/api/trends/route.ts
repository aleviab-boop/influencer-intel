import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { TrendSignal } from '@influencer-intel/shared/types';

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

  const trends = await db.query<TrendSignal>(
    `SELECT * FROM trend_signals ${whereClause} ORDER BY velocity DESC LIMIT ${limit}`,
    queryParams,
  );

  return NextResponse.json({ trends, total: trends.length });
}
