import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { findInfluencersForRegion } from '@/lib/region-influencers';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const city = (body.city ?? '').trim();
  const state = (body.state ?? '').trim() || null;
  const category = (body.category ?? '').trim() || undefined;
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 50)));

  if (!city) {
    return NextResponse.json({ error: 'city is required' }, { status: 400 });
  }

  const db = getBolticClient();

  // Try to infer city_tier from existing stores in same city
  const existing = await db.query<{ city_tier: string }>(
    `SELECT city_tier FROM stores WHERE LOWER(city) = $1 AND city_tier != 'unknown' LIMIT 1`,
    [city.toLowerCase()],
  );
  const cityTier = existing[0]?.city_tier ?? null;

  const influencers = await findInfluencersForRegion(db, city, state, cityTier, category, limit);

  return NextResponse.json({
    city,
    state,
    category: category ?? null,
    city_tier: cityTier,
    influencers,
  });
}
