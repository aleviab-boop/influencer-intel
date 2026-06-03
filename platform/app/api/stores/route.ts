import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const city = (url.searchParams.get('city') ?? '').trim().toLowerCase();
  const state = (url.searchParams.get('state') ?? '').trim().toLowerCase();
  const region = (url.searchParams.get('region') ?? '').trim().toLowerCase();
  const search = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  const where: string[] = ['is_active = true'];
  const params: unknown[] = [];

  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(LOWER(store_name) LIKE $${i} OR LOWER(city) LIKE $${i} OR LOWER(store_code) LIKE $${i})`);
  }
  if (city) {
    params.push(`%${city}%`);
    where.push(`LOWER(city) LIKE $${params.length}`);
  }
  if (state) {
    params.push(`%${state}%`);
    where.push(`LOWER(state) LIKE $${params.length}`);
  }
  if (region) {
    params.push(region);
    where.push(`LOWER(region) = $${params.length}`);
  }

  const db = getBolticClient();
  const rows = await db.query(
    `SELECT * FROM stores WHERE ${where.join(' AND ')} ORDER BY store_name LIMIT 200`,
    params,
  );

  return NextResponse.json({ stores: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const stores: Array<{
    store_name: string;
    store_code?: string;
    city: string;
    state?: string;
    region?: string;
    pin_code?: string;
    city_tier?: string;
    opened_at?: string;
  }> = body.stores;

  if (!Array.isArray(stores) || stores.length === 0) {
    return NextResponse.json({ error: 'stores array required' }, { status: 400 });
  }
  if (stores.length > 500) {
    return NextResponse.json({ error: 'Max 500 stores per batch' }, { status: 400 });
  }

  const db = getBolticClient();
  const results = [];

  for (const s of stores) {
    if (!s.store_name || !s.city) continue;
    const row = await db.upsert(
      'stores',
      {
        store_name: s.store_name,
        store_code: s.store_code ?? null,
        city: s.city,
        state: s.state ?? null,
        region: s.region ?? null,
        pin_code: s.pin_code ?? null,
        city_tier: s.city_tier ?? 'unknown',
        is_active: true,
        opened_at: s.opened_at ?? null,
        created_at: new Date().toISOString(),
      },
      ['store_name', 'city'],
    );
    results.push(row);
  }

  return NextResponse.json({ imported: results.length, stores: results });
}
