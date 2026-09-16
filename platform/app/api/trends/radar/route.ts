import { NextResponse } from 'next/server';
import { getTrendRadar } from '@/lib/trend-radar';

export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/trends/radar — AI "trend radar": specific consumer trends paired with
// the marketing category they're breaking in (e.g. "polka dot → Fashion"). Cache-
// first from system_config (a cold cache lazily fills once); the daily
// trends-refresh cron keeps it warm. No Apify, no per-visit OpenAI spend.
export async function GET(): Promise<NextResponse> {
  try {
    const radar = await getTrendRadar();
    return NextResponse.json(radar);
  } catch (err) {
    // Never hard-fail the public board — return an empty snapshot on error.
    return NextResponse.json(
      { items: [], generated_at: null, minutes_old: null, stale: true, error: (err as Error).message },
      { status: 200 },
    );
  }
}
