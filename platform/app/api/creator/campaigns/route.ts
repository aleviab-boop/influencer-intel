import { NextResponse } from 'next/server';
import { listOpenCampaigns } from '@/lib/creator-portal-service';

export const runtime = 'nodejs';

// GET /api/creator/campaigns → open (active) brand campaigns a creator can apply to
export async function GET() {
  try {
    const campaigns = await listOpenCampaigns();
    return NextResponse.json({ campaigns });
  } catch (err) {
    console.error('[creator] campaigns failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
