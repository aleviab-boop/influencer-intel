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

// Cities are DYNAMIC — derived from the DB (top cities by active-creator count)
// so the grid always shows where the data actually is, with no hardcoded list to
// maintain. A small alias map merges dual-name cities so they don't appear twice;
// everything else is title-cased as-is.
const CITY_ALIAS: Record<string, string> = {
  bombay: 'Mumbai', mumbai: 'Mumbai',
  bengaluru: 'Bangalore', bangalore: 'Bangalore',
  calcutta: 'Kolkata', kolkata: 'Kolkata',
  gurugram: 'Gurgaon', gurgaon: 'Gurgaon',
  mysuru: 'Mysore', mysore: 'Mysore',
  cochin: 'Kochi', ernakulam: 'Kochi', kochi: 'Kochi',
  thiruvananthapuram: 'Trivandrum', trivandrum: 'Trivandrum',
  vizag: 'Visakhapatnam', visakhapatnam: 'Visakhapatnam',
  baroda: 'Vadodara', vadodara: 'Vadodara',
  mangaluru: 'Mangalore', mangalore: 'Mangalore',
  banaras: 'Varanasi', varanasi: 'Varanasi',
  delhi: 'Delhi',
};
const TOP_CITIES = 24;
// Junk / non-city location strings to keep off the grid.
const CITY_STOP = new Set(['india', 'indian', 'earth', 'worldwide', 'global', 'online', 'everywhere']);
const titleCase = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
const canonCity = (raw: string): string => {
  for (const [k, v] of Object.entries(CITY_ALIAS)) if (raw.includes(k)) return v;
  return titleCase(raw);
};
// Substring `match` terms for the matrix SQL: the alias keys that map to a
// canonical (so '%mumbai%' catches "mumbai - मुंबई", "mumbai ncr", etc.), else
// the canonical name itself.
function matchTerms(label: string): string[] {
  const keys = Object.entries(CITY_ALIAS).filter(([, v]) => v === label).map(([k]) => k);
  return keys.length ? keys : [label.toLowerCase()];
}

// Top cities by active-creator count, alias-merged.
async function topCities(db: ReturnType<typeof getBolticClient>): Promise<Array<{ label: string; match: string[] }>> {
  let rows: Array<{ city: string; n: number }> = [];
  try {
    rows = await db.query<{ city: string; n: number }>(
      `select lower(coalesce(nullif(primary_city,''), region, '')) as city, count(*)::int as n
       from creators
       where platform='instagram' and is_active=true
         and coalesce(nullif(primary_city,''), region) is not null
       group by 1`,
    );
  } catch { rows = []; }
  const merged = new Map<string, number>();
  for (const r of rows) {
    const raw = (r.city ?? '').trim();
    if (!raw || CITY_STOP.has(raw)) continue;
    const label = canonCity(raw);
    merged.set(label, (merged.get(label) ?? 0) + Number(r.n));
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_CITIES)
    .map(([label]) => ({ label, match: matchTerms(label) }));
}

// Note: NICHES is a curated taxonomy (free-text niche values are too messy to
// auto-derive); CITIES are dynamic. Both are code-derived, not user input, so
// inlining them in SQL is safe.
const like = (col: string, terms: string[]) => `(${terms.map((t) => `${col} like '%${t}%'`).join(' or ')})`;

export async function GET() {
  const db = getBolticClient();
  const CITIES = await topCities(db);
  if (CITIES.length === 0) {
    return NextResponse.json({
      niches: NICHES.map((n) => ({ key: n.key, label: n.label })),
      cities: [], matrix: [], nicheTotals: [], grandTotal: 0,
    });
  }
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
    rows = await db.query<Record<string, unknown>>(sql);
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
