import { NextResponse } from 'next/server';
import { listPayouts } from '@/lib/programs-service';

export const runtime = 'nodejs';

// GET /api/payouts → every payable recruit across all campaigns
export async function GET() {
  try {
    const payouts = await listPayouts();
    return NextResponse.json({ payouts });
  } catch (err) {
    console.error('[payouts] list failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
