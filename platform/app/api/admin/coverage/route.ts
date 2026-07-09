import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// Coverage dashboard data: how many creators we have for each niche x city, so
// the team can see what's well-covered and where the gaps are (crawl those).

const NICHES: Array<{ key: string; label: string; match: string[] }> = [
  { key: 'fashion', label: 'Fashion', match: ['fashion'] },
  { key: 'beauty', label: 'Beauty', match: ['beauty', 'makeup', 'skincare'] },
  { key: 'food', label: 'Food', match: ['food', 'cafe', 'recipe', 'foodie'] },
  { key: 'fitness', label: 'Fitness', match: ['fitness', 'gym', 'yoga', 'workout'] },
  { key: 'travel', label: 'Travel', match: ['travel'] },
  { key: 'lifestyle', label: 'Lifestyle', match: ['lifestyle'] },
  { key: 'comedy', label: 'Comedy', match: ['comedy', 'humor'] },
  { key: 'tech', label: 'Tech', match: ['tech', 'gadget'] },
  { key: 'dance', label: 'Dance', match: ['dance'] },
  { key: 'home', label: 'Home/Decor', match: ['decor', 'interior', 'home'] },
  { key: 'parenting', label: 'Parenting', match: ['parenting', 'mom', 'baby'] },
  { key: 'finance', label: 'Finance', match: ['finance', 'investing', 'stock'] },
];

const CITIES: Array<{ label: string; match: string[] }> = [
  { label: 'Mumbai', match: ['mumbai', 'bombay'] },
  { label: 'Delhi', match: ['delhi'] },
  { label: 'Bangalore', match: ['bangalore', 'bengaluru'] },
  { label: 'Hyderabad', match: ['hyderabad'] },
  { label: 'Chennai', match: ['chennai'] },
  { label: 'Kolkata', match: ['kolkata', 'calcutta'] },
  { label: 'Pune', match: ['pune'] },
  { label: 'Ahmedabad', match: ['ahmedabad'] },
  { label: 'Jaipur', match: ['jaipur'] },
  { label: 'Chandigarh', match: ['chandigarh'] },
  { label: 'Kochi', match: ['kochi', 'cochin'] },
  { label: 'Lucknow', match: ['lucknow'] },
  { label: 'Nagpur', match: ['nagpur'] },
  { label: 'Surat', match: ['surat'] },
  { label: 'Goa', match: ['goa', 'panaji'] },
  { label: 'Indore', match: ['indore'] },
  { label: 'Gurgaon', match: ['gurgaon', 'gurugram'] },
  { label: 'Noida', match: ['noida'] },
  { label: 'Bhopal', match: ['bhopal'] },
  { label: 'Mysore', match: ['mysore', 'mysuru'] },
  { label: 'Udaipur', match: ['udaipur'] },
  { label: 'Varanasi', match: ['varanasi', 'banaras'] },
  { label: 'Guwahati', match: ['guwahati'] },
  { label: 'Shillong', match: ['shillong'] },
];

// Note: NICHES/CITIES are hardcoded (not user input) so inlining them in SQL is safe.
const like = (col: string, terms: string[]) => `(${terms.map((t) => `${col} like '%${t}%'`).join(' or ')})`;

export async function GET() {
  const nicheSums = NICHES.map((n) => `sum((${like('nt', n.match)})::int) as ${n.key}`).join(',\n           ');
  const cityCase =
    `case ${CITIES.map((c) => `when ${like('cr', c.match)} then '${c.label}'`).join('\n              ')}\n              else null end`;

  const sql = `
    with base as (
      select
        lower(coalesce(primary_category,'') || ' ' || coalesce(niche,'') || ' ' ||
              coalesce(genre,'') || ' ' || coalesce(array_to_string(tags, ' '), '')) as nt,
        lower(coalesce(nullif(primary_city,''), region, '')) as cr
      from creators
      where platform = 'instagram' and is_active = true
    ),
    tagged as (
      select nt, (${cityCase}) as city from base
    )
    select city, count(*)::int as total,
           ${nicheSums}
    from tagged
    where city is not null
    group by city
  `;

  let rows: Record<string, unknown>[] = [];
  try {
    rows = await getBolticClient().query<Record<string, unknown>>(sql);
  } catch (err) {
    console.error('[coverage] query failed:', err);
  }

  const byCity = new Map(rows.map((r) => [String(r.city), r]));
  const matrix = CITIES.map((c) => {
    const r = byCity.get(c.label);
    const cells = NICHES.map((n) => ({ niche: n.key, count: Number(r?.[n.key] ?? 0) }));
    return { city: c.label, total: Number(r?.total ?? 0), cells };
  });

  // Column totals (per niche across all cities) for the footer row.
  const nicheTotals = NICHES.map((n) => ({
    niche: n.key,
    count: matrix.reduce((s, row) => s + (row.cells.find((c) => c.niche === n.key)?.count ?? 0), 0),
  }));

  return NextResponse.json({
    niches: NICHES.map((n) => ({ key: n.key, label: n.label })),
    cities: CITIES.map((c) => c.label),
    matrix,
    nicheTotals,
    grandTotal: matrix.reduce((s, r) => s + r.total, 0),
  });
}
