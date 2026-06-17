import ExcelJS from 'exceljs';
import pg from 'pg';
import fs from 'node:fs';

// ---- env / db ----
const envText = fs.readFileSync('./.env', 'utf8');
for (const line of envText.split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
let conn = process.env.BOLTIC_DATABASE_URL; try { const u = new URL(conn); u.searchParams.delete('sslmode'); conn = u.toString(); } catch {}
const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

const handleFromUrl = (u) => {
  if (!u) return null;
  let s = String(u);
  // Unwrap Google redirect links: ...google.com/url?q=<encoded instagram url>&...
  const g = s.match(/[?&]q=([^&]+)/);
  if (g && /google\.com\/url/i.test(s)) { try { s = decodeURIComponent(g[1]); } catch { /* keep */ } }
  // Stop at / ? # & or whitespace so trailing query params aren't captured.
  const m = s.match(/instagram\.com\/([^/?#&\s]+)/i);
  if (!m) return null;
  const h = m[1].trim().toLowerCase().replace(/^@/, '');
  if (['p', 'reel', 'reels', 'stories', 'explore'].includes(h)) return null;
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
};
const parseFollowers = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim().toUpperCase().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*([KM]?)/); if (!m) return null;
  let n = parseFloat(m[1]); if (m[2] === 'K') n *= 1e3; else if (m[2] === 'M') n *= 1e6;
  return Math.round(n);
};
const cell = (row, i) => { const c = row.getCell(i); const v = c.value; return v && v.text ? v.text : v; };
// Links may be stored as ExcelJS hyperlink objects { text, hyperlink } — prefer the URL.
const cellLink = (row, i) => {
  const v = row.getCell(i).value;
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.hyperlink || v.text || v.result || null;
  return String(v);
};
const str = (v) => (v == null ? null : String(v).trim() || null);

async function readSheet(path) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path);
  return wb.getWorksheet('Sheet1');
}

const BATCH = 'campaign_import_2026-06-17';
const records = [];

// 1. Aneet — Sr No, Creator Name, Link, City
{
  const ws = await readSheet('/Users/aleviabandyopadhyay/Downloads/Aneet Influencer Campaign.xlsx');
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = str(cell(row, 2)), link = cellLink(row, 3), loc = str(cell(row, 4));
    const handle = handleFromUrl(link); if (!handle) continue;
    records.push({ handle, name, link, loc, followers: null, er: null, tag: 'aneet-campaign', meta: { import_batch: BATCH, campaign: 'Aneet', source_file: 'Aneet Influencer Campaign.xlsx', location_raw: loc } });
  }
}
// 2. Baisakhi — Name, Link, Followers, Location, ER%, Avg views, demographics
{
  const ws = await readSheet('/Users/aleviabandyopadhyay/Downloads/Baisakhi Campaign.xlsx');
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = str(cell(row, 1)), link = cellLink(row, 2);
    const handle = handleFromUrl(link); if (!handle) continue;
    const er = typeof cell(row, 5) === 'number' ? cell(row, 5) : null;
    records.push({
      handle, name, link, loc: str(cell(row, 4)), followers: parseFollowers(cell(row, 3)), er,
      tag: 'baisakhi-campaign',
      meta: { import_batch: BATCH, campaign: 'Baisakhi', source_file: 'Baisakhi Campaign.xlsx', location_raw: str(cell(row, 4)),
        avg_views: parseFollowers(cell(row, 6)),
        audience: { gender_split: str(cell(row, 7)), age_groups: [8,9,10,11,12].map(i=>str(cell(row,i))).filter(Boolean), top_cities: [13,14,15].map(i=>str(cell(row,i))).filter(Boolean) } },
    });
  }
}
// 3. Bihu — Name, Link, Followers, Nearest Store
{
  const ws = await readSheet('/Users/aleviabandyopadhyay/Downloads/Bihu Campaign.xlsx');
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = str(cell(row, 1)), link = cellLink(row, 2);
    const handle = handleFromUrl(link); if (!handle) continue;
    records.push({ handle, name, link, followers: parseFollowers(cell(row, 3)), loc: null, er: null, tag: 'bihu-campaign', meta: { import_batch: BATCH, campaign: 'Bihu', source_file: 'Bihu Campaign.xlsx', nearest_store: str(cell(row, 4)) } });
  }
}

// 4. Holi 1 — Sr No, Influencer Name, Link, Location
{
  const ws = await readSheet('/Users/aleviabandyopadhyay/Downloads/Holi Campaign 1.xlsx');
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = str(cell(row, 2)), link = cellLink(row, 3), loc = str(cell(row, 4));
    const handle = handleFromUrl(link); if (!handle) continue;
    records.push({ handle, name, link, loc, followers: null, er: null, tag: 'holi-campaign', meta: { import_batch: BATCH, campaign: 'Holi', source_file: 'Holi Campaign 1.xlsx', location_raw: loc } });
  }
}
// 5. Holi 2 — Influencer Name, Link, Location
{
  const ws = await readSheet('/Users/aleviabandyopadhyay/Downloads/Holi Campaign 2.xlsx');
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = str(cell(row, 1)), link = cellLink(row, 2), loc = str(cell(row, 3));
    const handle = handleFromUrl(link); if (!handle) continue;
    records.push({ handle, name, link, loc, followers: null, er: null, tag: 'holi-campaign', meta: { import_batch: BATCH, campaign: 'Holi', source_file: 'Holi Campaign 2.xlsx', location_raw: loc } });
  }
}

console.log('parsed records:', records.length);
const byTag = {}; records.forEach(r => byTag[r.tag] = (byTag[r.tag]||0)+1); console.log('by campaign:', JSON.stringify(byTag));

const client = await pool.connect();
let ok = 0, fail = 0;
try {
  await client.query('BEGIN');
  for (const r of records) {
    try {
      await client.query(
        `INSERT INTO creators
           (platform, handle, display_name, profile_url, source_url, follower_count, engagement_rate,
            primary_city, region, is_active, is_indian, source, entity_type, tags, raw_metadata)
         VALUES ('instagram',$1,$2,$3,$3,$4::numeric,$5::numeric,$6,$6,true,true,'manual','creator',
                 ARRAY['campaign', $7]::text[], $8::jsonb)
         ON CONFLICT (platform, handle) DO UPDATE SET
           display_name = COALESCE(EXCLUDED.display_name, creators.display_name),
           profile_url  = COALESCE(EXCLUDED.profile_url, creators.profile_url),
           source_url   = COALESCE(EXCLUDED.source_url, creators.source_url),
           follower_count  = COALESCE(EXCLUDED.follower_count, creators.follower_count),
           engagement_rate = COALESCE(EXCLUDED.engagement_rate, creators.engagement_rate),
           primary_city = COALESCE(EXCLUDED.primary_city, creators.primary_city),
           region       = COALESCE(EXCLUDED.region, creators.region),
           is_active = true, is_indian = true,
           tags = ( SELECT array(SELECT DISTINCT unnest(COALESCE(creators.tags,'{}'::text[]) || EXCLUDED.tags)) ),
           raw_metadata = COALESCE(creators.raw_metadata,'{}'::jsonb) || EXCLUDED.raw_metadata,
           updated_at = now()`,
        [r.handle, r.name ?? r.handle, r.link, r.followers ?? null, r.er ?? null, r.loc ?? null, r.tag, JSON.stringify(r.meta)],
      );
      ok++;
    } catch (e) { fail++; if (fail <= 5) console.error('FAIL', r.handle, e.message); }
  }
  await client.query('COMMIT');
} catch (e) { await client.query('ROLLBACK'); console.error('ROLLBACK', e.message); process.exit(1); }
finally { client.release(); }

console.log(`upserted ok=${ok} fail=${fail}`);
for (const tag of ['aneet-campaign','baisakhi-campaign','bihu-campaign','holi-campaign']) {
  const c = await pool.query(`SELECT count(*)::int n FROM creators WHERE $1 = ANY(tags)`, [tag]);
  console.log(`  ${tag}: ${c.rows[0].n} in DB`);
}
await pool.end();
