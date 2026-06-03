import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { Brand, Brief } from '@influencer-intel/shared/types';
import { startShortlistGeneration } from '@/lib/shortlist-service';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.raw_text !== 'string' || body.raw_text.trim().length < 10) {
    return NextResponse.json({ error: 'raw_text must be at least 10 characters' }, { status: 400 });
  }

  const db = getBolticClient();
  // If signed-in, the brand is the user's brand. Otherwise fall back to the
  // default Trends brand (preserves the demo flow for unauth requests).
  const session = await getSession();
  const brandId = session?.brand_id ?? (typeof body.brand_id === 'string'
    ? body.brand_id
    : await getOrCreateDefaultBrand(db));

  const llm = getOpenAIClient();
  const parsed = await llm.parseBrief(body.raw_text);
  const briefEmbedding = await llm.embed(
    [body.raw_text, parsed.category ?? '', (parsed.target_cities ?? []).join(' ')].join(' '),
  );

  const brief = await db.insert<Brief>('briefs', {
    brand_id: brandId,
    raw_text: body.raw_text,
    parsed_spec: parsed,
    brief_embedding: briefEmbedding,
    status: 'parsed',
    parsed_at: new Date().toISOString(),
  });

  const result = await startShortlistGeneration(brief);

  return NextResponse.json({
    brief_id: brief.id,
    preliminary: result.preliminary,
    pending_count: result.pending_count,
    parsed_spec: parsed,
  });
}

async function getOrCreateDefaultBrand(db: ReturnType<typeof getBolticClient>): Promise<string> {
  // First design partner: Reliance Trends (mid-market fashion).
  const rows = await db.query<Brand>(`SELECT * FROM brands WHERE slug = 'trends' LIMIT 1`);
  if (rows[0]) return rows[0].id;
  const created = await db.insert<Brand>('brands', {
    name: 'Trends',
    slug: 'trends',
    category: 'fashion',
    plan: 'design_partner',
    research_quota_used: 0,
    research_quota_max: 50,
    onboarded_at: new Date().toISOString(),
  });
  return created.id;
}
