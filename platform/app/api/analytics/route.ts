import { NextRequest, NextResponse } from 'next/server';
import { getAnalytics, type Period } from '@/lib/analytics-service';

export const runtime = 'nodejs';

const PERIODS: Period[] = ['7d', '30d', '90d', 'all'];

// GET /api/analytics?period=7d|30d|90d|all → { totals, per_campaign, outcomes, period }
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams.get('period');
  const period: Period = PERIODS.includes(p as Period) ? (p as Period) : 'all';
  try {
    const data = await getAnalytics(period);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[analytics] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
