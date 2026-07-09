// ============================================================
// backfill-location.mjs
//
// One-off (re-runnable) backfill: most crawled creators land with NO
// primary_city because they were found via niche hashtags, not a location
// query — even though their bio/name/handle usually names their city. This
// scans those unlocated creators for a known city (whole-word, high-precision)
// and fills primary_city + primary_state, so the Coverage dashboard and the
// location ranking actually reflect the DB.
//
// Only touches creators with an EMPTY location (never overwrites). Match is
// word-boundary on the FULL city name across bio + display_name + handle.
//
// Run:  cd platform && node --env-file=.env scripts/backfill-location.mjs
//       add DRY_RUN=1 to preview counts without writing.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

const DRY = process.env.DRY_RUN === '1';
const db = getBolticClient();

// Canonical city → state, with aliases. Order matters: bigger metros first so a
// bio naming two places prefers the primary one.
const CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', a: ['mumbai', 'bombay'] },
  { city: 'Delhi', state: 'Delhi', a: ['delhi', 'newdelhi', 'dilli'] },
  { city: 'Bangalore', state: 'Karnataka', a: ['bangalore', 'bengaluru'] },
  { city: 'Hyderabad', state: 'Telangana', a: ['hyderabad'] },
  { city: 'Chennai', state: 'Tamil Nadu', a: ['chennai', 'madras'] },
  { city: 'Kolkata', state: 'West Bengal', a: ['kolkata', 'calcutta'] },
  { city: 'Pune', state: 'Maharashtra', a: ['pune'] },
  { city: 'Ahmedabad', state: 'Gujarat', a: ['ahmedabad'] },
  { city: 'Surat', state: 'Gujarat', a: ['surat'] },
  { city: 'Vadodara', state: 'Gujarat', a: ['vadodara', 'baroda'] },
  { city: 'Rajkot', state: 'Gujarat', a: ['rajkot'] },
  { city: 'Jaipur', state: 'Rajasthan', a: ['jaipur'] },
  { city: 'Jodhpur', state: 'Rajasthan', a: ['jodhpur'] },
  { city: 'Udaipur', state: 'Rajasthan', a: ['udaipur'] },
  { city: 'Lucknow', state: 'Uttar Pradesh', a: ['lucknow'] },
  { city: 'Kanpur', state: 'Uttar Pradesh', a: ['kanpur'] },
  { city: 'Noida', state: 'Uttar Pradesh', a: ['noida'] },
  { city: 'Agra', state: 'Uttar Pradesh', a: ['agra'] },
  { city: 'Varanasi', state: 'Uttar Pradesh', a: ['varanasi', 'banaras'] },
  { city: 'Chandigarh', state: 'Chandigarh', a: ['chandigarh'] },
  { city: 'Ludhiana', state: 'Punjab', a: ['ludhiana'] },
  { city: 'Amritsar', state: 'Punjab', a: ['amritsar'] },
  { city: 'Jalandhar', state: 'Punjab', a: ['jalandhar'] },
  { city: 'Kochi', state: 'Kerala', a: ['kochi', 'cochin', 'ernakulam'] },
  { city: 'Trivandrum', state: 'Kerala', a: ['trivandrum', 'thiruvananthapuram'] },
  { city: 'Kozhikode', state: 'Kerala', a: ['kozhikode', 'calicut'] },
  { city: 'Thrissur', state: 'Kerala', a: ['thrissur'] },
  { city: 'Guwahati', state: 'Assam', a: ['guwahati'] },
  { city: 'Dibrugarh', state: 'Assam', a: ['dibrugarh'] },
  { city: 'Silchar', state: 'Assam', a: ['silchar'] },
  { city: 'Jorhat', state: 'Assam', a: ['jorhat'] },
  { city: 'Bhubaneswar', state: 'Odisha', a: ['bhubaneswar'] },
  { city: 'Cuttack', state: 'Odisha', a: ['cuttack'] },
  { city: 'Patna', state: 'Bihar', a: ['patna'] },
  { city: 'Indore', state: 'Madhya Pradesh', a: ['indore'] },
  { city: 'Bhopal', state: 'Madhya Pradesh', a: ['bhopal'] },
  { city: 'Nagpur', state: 'Maharashtra', a: ['nagpur'] },
  { city: 'Nashik', state: 'Maharashtra', a: ['nashik'] },
  { city: 'Thane', state: 'Maharashtra', a: ['thane'] },
  { city: 'Coimbatore', state: 'Tamil Nadu', a: ['coimbatore'] },
  { city: 'Madurai', state: 'Tamil Nadu', a: ['madurai'] },
  { city: 'Mysore', state: 'Karnataka', a: ['mysore', 'mysuru'] },
  { city: 'Mangalore', state: 'Karnataka', a: ['mangalore', 'mangaluru'] },
  { city: 'Hubli', state: 'Karnataka', a: ['hubli'] },
  { city: 'Visakhapatnam', state: 'Andhra Pradesh', a: ['visakhapatnam', 'vizag'] },
  { city: 'Vijayawada', state: 'Andhra Pradesh', a: ['vijayawada'] },
  { city: 'Gurgaon', state: 'Haryana', a: ['gurgaon', 'gurugram'] },
  { city: 'Faridabad', state: 'Haryana', a: ['faridabad'] },
  { city: 'Dehradun', state: 'Uttarakhand', a: ['dehradun'] },
  { city: 'Ranchi', state: 'Jharkhand', a: ['ranchi'] },
  { city: 'Jamshedpur', state: 'Jharkhand', a: ['jamshedpur'] },
  { city: 'Raipur', state: 'Chhattisgarh', a: ['raipur'] },
  { city: 'Goa', state: 'Goa', a: ['goa', 'panaji'] },
  { city: 'Shillong', state: 'Meghalaya', a: ['shillong'] },
  { city: 'Siliguri', state: 'West Bengal', a: ['siliguri'] },
  { city: 'Srinagar', state: 'Jammu & Kashmir', a: ['srinagar'] },
  { city: 'Jammu', state: 'Jammu & Kashmir', a: ['jammu'] },
];

// Precompile a word-boundary matcher per city (any alias as a standalone token).
const MATCHERS = CITIES.map((c) => ({
  ...c,
  re: new RegExp(`(^|[^a-z])(${c.a.join('|')})([^a-z]|$)`, 'i'),
}));

function detectCity(text) {
  for (const m of MATCHERS) if (m.re.test(text)) return m;
  return null;
}

async function main() {
  console.log(`[backfill] loading unlocated creators${DRY ? ' (DRY RUN)' : ''}…`);
  const rows = await db.query(
    `SELECT id, handle, display_name, bio
     FROM creators
     WHERE platform='instagram'
       AND coalesce(nullif(primary_city,''), nullif(region,'')) IS NULL
       AND (bio IS NOT NULL OR display_name IS NOT NULL)`,
  );
  console.log(`[backfill] ${rows.length} candidates.`);

  // Group matched creator ids by city so we can bulk-update (one UPDATE per city).
  const byCity = new Map();
  for (const r of rows) {
    const text = `${r.bio ?? ''} ${r.display_name ?? ''} ${r.handle ?? ''}`.toLowerCase();
    const hit = detectCity(text);
    if (!hit) continue;
    if (!byCity.has(hit.city)) byCity.set(hit.city, { state: hit.state, ids: [] });
    byCity.get(hit.city).ids.push(r.id);
  }

  const matched = [...byCity.values()].reduce((s, v) => s + v.ids.length, 0);
  console.log(`[backfill] matched ${matched} / ${rows.length} to a city.`);
  const dist = [...byCity.entries()].map(([c, v]) => [c, v.ids.length]).sort((a, b) => b[1] - a[1]);
  for (const [c, n] of dist.slice(0, 20)) console.log(`   ${c}: ${n}`);

  if (DRY) { console.log('[backfill] DRY RUN — no writes.'); process.exit(0); }

  let updated = 0;
  for (const [city, { state, ids }] of byCity) {
    // Chunk to keep the parameter array sane.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await db.query(
        `UPDATE creators SET primary_city=$1, primary_state=coalesce(nullif(primary_state,''),$2), updated_at=now()
         WHERE id = ANY($3::uuid[])`,
        [city, state, chunk],
      );
      updated += chunk.length;
    }
    console.log(`   ✓ ${city}: ${ids.length}`);
  }
  console.log(`[backfill] done — set location on ${updated} creators.`);
  process.exit(0);
}

main().catch((e) => { console.error('[backfill] failed:', e); process.exit(1); });
