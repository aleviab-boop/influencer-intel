import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { liveBrandCollabs } from '@/lib/live-discovery';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/brand-mentions/live?company=Nykaa&exclude=handle1,handle2
//   Find creators who work with a brand by crawling Instagram LIVE, not just our
//   DB. We seed the crawl two ways:
//     1. Brand-handle guesses (nykaa, nykaaofficial, nykaaindia, …) — the brand's
//        own account, whose captions @-tag creators and whose related-profiles
//        cluster the space.
//     2. The top creators already in our DB for this brand — we expand THEIR
//        @mention / related-profile network, which tends to surface peers who
//        also work with the brand.
//   Then each crawled profile is kept only if its recent captions (or bio) name
//   the brand, with the matching caption + post URL as proof. Handles the page
//   already shows (?exclude=) and existing DB rows are filtered out, so this
//   returns genuinely NEW creators.

function brandHandleSeeds(company: string): string[] {
  const base = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (base.length < 2) return [];
  return Array.from(new Set([base, `${base}official`, `${base}india`, `${base}_official`, `${base}.official`]))
    .filter((h) => /^[a-z0-9._]{2,30}$/.test(h));
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const company = (url.searchParams.get('company') ?? '').trim();
  const exclude = new Set(
    (url.searchParams.get('exclude') ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
  );

  if (company.length < 2) {
    return NextResponse.json({ creators: [], total: 0, company });
  }

  try {
    const db = getBolticClient();

    // Seed 2: the highest-reach creators our DB already links to this brand —
    // crawling their network is where most new collaborators come from.
    const esc = company.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dbSeeds = await db.query<{ handle: string }>(
      `SELECT c.handle FROM creators c
        WHERE c.is_active = true
          AND jsonb_typeof(c.raw_metadata->'vision'->'brand_mentions') = 'array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(c.raw_metadata->'vision'->'brand_mentions') bm(mention)
                      WHERE lower(bm.mention) = lower($1) OR lower(bm.mention) ~ ('\\y' || $2 || '\\y'))
        ORDER BY c.follower_count DESC NULLS LAST
        LIMIT 8`,
      [company, esc],
    );

    const seeds = Array.from(new Set([...brandHandleSeeds(company), ...dbSeeds.map((r) => r.handle)]));
    if (seeds.length === 0) {
      return NextResponse.json({ creators: [], total: 0, company });
    }

    const { results } = await liveBrandCollabs(company, seeds, { depth: 2, max: 30, budgetMs: 45_000 });

    // Drop anything the page already shows (from the DB search) or that already
    // exists in our creators table — we only want genuinely new finds here.
    const candidates = results.filter((r) => !exclude.has(r.username.toLowerCase()));
    let creators = candidates;
    if (candidates.length > 0) {
      const existing = await db.query<{ handle: string }>(
        `SELECT lower(handle) AS handle FROM creators WHERE lower(handle) = ANY($1)`,
        [candidates.map((c) => c.username.toLowerCase())],
      );
      const known = new Set(existing.map((r) => r.handle));
      creators = candidates.filter((c) => !known.has(c.username.toLowerCase()));
    }

    return NextResponse.json({ creators, total: creators.length, company });
  } catch (err) {
    console.error('[brand-mentions/live] crawl failed:', err);
    return NextResponse.json({ error: (err as Error).message, creators: [], total: 0, company }, { status: 500 });
  }
}
