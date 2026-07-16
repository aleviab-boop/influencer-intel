import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getAnalytics, type Period } from '@/lib/analytics-service';

export const runtime = 'nodejs';

// GET /api/admin/analytics?period=7d|30d|90d|all
//   Two things in one payload:
//     db      — a snapshot of the creator database (inventory, distributions,
//               freshness) — period-independent.
//     funnel  — the recruitment pipeline across all campaigns.
//     campaigns — the existing campaign/outcome analytics (respects period).
//   Every query is isolated so a missing column or empty table degrades to a
//   safe default instead of 500-ing the whole page.

const PERIODS: Period[] = ['7d', '30d', '90d', 'all'];

export async function GET(req: NextRequest) {
  const db = getBolticClient();
  const p = new URL(req.url).searchParams.get('period');
  const period: Period = PERIODS.includes(p as Period) ? (p as Period) : 'all';

  // Run one SQL and return the first row, or a fallback if it throws.
  async function row<T extends Record<string, unknown>>(sql: string, fallback: T): Promise<T> {
    try {
      const rows = await db.query<T>(sql);
      return rows[0] ?? fallback;
    } catch {
      return fallback;
    }
  }
  async function rows<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
    try {
      return await db.query<T>(sql);
    } catch {
      return [];
    }
  }

  const NICHE_EXPR = `lower(coalesce(nullif(trim(primary_category),''), nullif(trim(niche),''), nullif(trim(genre),'')))`;
  const CITY_EXPR = `lower(coalesce(nullif(trim(primary_city),''), nullif(trim(region),'')))`;

  const [
    overview,
    completeness,
    tiers,
    genderRows,
    nicheRows,
    cityRows,
    erBuckets,
    qualityRows,
    freshness,
    scrapeDaily,
    funnelRows,
    campaigns,
  ] = await Promise.all([
    row(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE is_active)::int active,
              count(*) FILTER (WHERE is_indian)::int indian,
              count(*) FILTER (WHERE is_verified)::int verified
       FROM creators WHERE platform='instagram'`,
      { total: 0, active: 0, indian: 0, verified: 0 },
    ),
    row(
      `SELECT count(*) FILTER (WHERE follower_count IS NOT NULL)::int follower,
              count(*) FILTER (WHERE engagement_rate IS NOT NULL)::int engagement,
              count(*) FILTER (WHERE quality_score IS NOT NULL)::int quality,
              count(*) FILTER (WHERE gender IN ('female','male'))::int gender
       FROM creators WHERE platform='instagram'`,
      { follower: 0, engagement: 0, quality: 0, gender: 0 },
    ),
    row(
      `SELECT count(*) FILTER (WHERE follower_count < 10000)::int nano,
              count(*) FILTER (WHERE follower_count >= 10000 AND follower_count < 100000)::int micro,
              count(*) FILTER (WHERE follower_count >= 100000 AND follower_count < 1000000)::int mid,
              count(*) FILTER (WHERE follower_count >= 1000000)::int mega,
              count(*) FILTER (WHERE follower_count IS NULL)::int unknown
       FROM creators`,
      { nano: 0, micro: 0, mid: 0, mega: 0, unknown: 0 },
    ),
    rows<{ g: string; n: number }>(
      `SELECT CASE WHEN gender IN ('female','male') THEN gender ELSE 'unlabeled' END g, count(*)::int n
       FROM creators GROUP BY 1`,
    ),
    rows<{ k: string; n: number }>(
      `SELECT ${NICHE_EXPR} k, count(*)::int n FROM creators
       WHERE ${NICHE_EXPR} IS NOT NULL AND ${NICHE_EXPR} <> '—'
       GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    ),
    rows<{ k: string; n: number }>(
      `SELECT ${CITY_EXPR} k, count(*)::int n FROM creators
       WHERE ${CITY_EXPR} IS NOT NULL AND ${CITY_EXPR} NOT IN ('india','—')
       GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    ),
    row(
      // engagement_rate is stored as a fraction (0.028 = 2.8%); cap at 1.0 to
      // drop a handful of garbage rows.
      `SELECT count(*) FILTER (WHERE engagement_rate < 0.01)::int b1,
              count(*) FILTER (WHERE engagement_rate >= 0.01 AND engagement_rate < 0.02)::int b2,
              count(*) FILTER (WHERE engagement_rate >= 0.02 AND engagement_rate < 0.03)::int b3,
              count(*) FILTER (WHERE engagement_rate >= 0.03 AND engagement_rate < 0.05)::int b4,
              count(*) FILTER (WHERE engagement_rate >= 0.05 AND engagement_rate < 0.08)::int b5,
              count(*) FILTER (WHERE engagement_rate >= 0.08 AND engagement_rate <= 1.0)::int b6
       FROM creators WHERE engagement_rate IS NOT NULL`,
      { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 },
    ),
    rows<{ b: string; n: number }>(
      `SELECT coalesce(quality_band,'unset') b, count(*)::int n FROM creators GROUP BY 1 ORDER BY 2 DESC`,
    ),
    // Freshness keys off the most-recent "we touched this creator" timestamp —
    // GREATEST(last_scraped_at, first_indexed_at) (Postgres GREATEST ignores
    // NULLs). So a creator DISCOVERED via search (first_indexed_at, no live
    // enrichment yet) counts as fresh instead of being invisible, and these
    // cards move as searches run — while a creator we discovered long ago and
    // never refreshed correctly shows as stale.
    row(
      `SELECT count(*) FILTER (WHERE GREATEST(last_scraped_at, first_indexed_at) > now()-interval '24 hours')::int d1,
              count(*) FILTER (WHERE GREATEST(last_scraped_at, first_indexed_at) > now()-interval '7 days')::int d7,
              count(*) FILTER (WHERE GREATEST(last_scraped_at, first_indexed_at) > now()-interval '30 days')::int d30,
              count(*) FILTER (WHERE GREATEST(last_scraped_at, first_indexed_at) IS NOT NULL AND GREATEST(last_scraped_at, first_indexed_at) < now()-interval '30 days')::int stale30,
              count(*) FILTER (WHERE GREATEST(last_scraped_at, first_indexed_at) IS NOT NULL AND GREATEST(last_scraped_at, first_indexed_at) < now()-interval '90 days')::int stale90
       FROM creators`,
      { d1: 0, d7: 0, d30: 0, stale30: 0, stale90: 0 },
    ),
    rows<{ d: string; n: number }>(
      `SELECT to_char(date_trunc('day', GREATEST(last_scraped_at, first_indexed_at)),'YYYY-MM-DD') d, count(*)::int n
       FROM creators WHERE GREATEST(last_scraped_at, first_indexed_at) > now()-interval '30 days'
       GROUP BY 1 ORDER BY 1`,
    ),
    rows<{ status: string; n: number }>(
      `SELECT status, count(*)::int n FROM program_recruits GROUP BY 1`,
    ),
    getAnalytics(period).catch(() => null),
  ]);

  const gmap = Object.fromEntries(genderRows.map((r) => [r.g, r.n]));
  const fmap = Object.fromEntries(funnelRows.map((r) => [r.status, r.n]));

  return NextResponse.json({
    period,
    db: {
      ...overview,
      completeness,
      tiers,
      gender: { female: gmap.female ?? 0, male: gmap.male ?? 0, unlabeled: gmap.unlabeled ?? 0 },
      niches: nicheRows,
      cities: cityRows,
      er_buckets: [
        { label: '<1%', n: erBuckets.b1 },
        { label: '1–2%', n: erBuckets.b2 },
        { label: '2–3%', n: erBuckets.b3 },
        { label: '3–5%', n: erBuckets.b4 },
        { label: '5–8%', n: erBuckets.b5 },
        { label: '8%+', n: erBuckets.b6 },
      ],
      quality_bands: qualityRows,
    },
    freshness: { ...freshness, daily: scrapeDaily },
    funnel: {
      applied: fmap.applied ?? 0,
      invited: fmap.invited ?? 0,
      contacted: fmap.contacted ?? 0,
      recruited: fmap.recruited ?? 0,
      declined: fmap.declined ?? 0,
    },
    campaigns,
  });
}
