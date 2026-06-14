import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { findInfluencersForRegion } from '@/lib/region-influencers';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getBolticClient();

  const stores = await db.query<{ city: string; state: string | null; city_tier: string | null }>(
    `SELECT city, state, city_tier FROM stores WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (stores.length === 0) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }

  const store = stores[0]!;
  const results = await findInfluencersForRegion(db, store.city, store.state, store.city_tier);

  return NextResponse.json({ store, influencers: results });
}
