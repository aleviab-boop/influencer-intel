import pg from 'pg';
import fs from 'node:fs';

// One-off import of the "Sale Seeding Influencer Campaign Fynd" list into the
// creators table. Idempotent: upserts on (platform, handle). Tagged
// 'fynd-seeding' so the batch is identifiable and removable.
const envText = fs.readFileSync('./.env', 'utf8');
for (const line of envText.split('\n')) { const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); }
let conn=process.env.BOLTIC_DATABASE_URL; try{const u=new URL(conn);u.searchParams.delete('sslmode');conn=u.toString();}catch{}
const pool=new pg.Pool({connectionString:conn,ssl:{rejectUnauthorized:false}});

const recs = JSON.parse(fs.readFileSync('/tmp/fynd.json','utf8')).filter(r=>r.handle);
const BATCH = 'fynd_sale_seeding_2026-06-16';
const client = await pool.connect();
let ok=0, fail=0;
try {
  await client.query('BEGIN');
  for (const r of recs) {
    const tags = ['fynd-seeding', 'lifestyle'];
    const meta = JSON.stringify({ import_batch: BATCH, source_file: 'Sale Seeding Influencer Campaign Fynd.xlsx', deliverables: r.deliv ?? null, location_raw: r.loc ?? null });
    try {
      await client.query(
        `INSERT INTO creators
          (platform, handle, display_name, profile_url, source_url, follower_count,
           primary_category, genre, niche, primary_city, region,
           is_active, is_indian, source, entity_type, tags, raw_metadata)
         VALUES ('instagram',$1,$2,$3,$3,$4::numeric,'Lifestyle','Lifestyle','Lifestyle',
                 $5,$5,true,true,'manual','creator',$6::text[],$7::jsonb)
         ON CONFLICT (platform, handle) DO UPDATE SET
           display_name=EXCLUDED.display_name, profile_url=EXCLUDED.profile_url,
           source_url=EXCLUDED.source_url, follower_count=EXCLUDED.follower_count,
           primary_category=EXCLUDED.primary_category, genre=EXCLUDED.genre,
           niche=EXCLUDED.niche, primary_city=EXCLUDED.primary_city, region=EXCLUDED.region,
           is_active=true, is_indian=true, tags=EXCLUDED.tags,
           raw_metadata=EXCLUDED.raw_metadata, updated_at=now()`,
        [r.handle, r.name ?? r.handle, r.link, r.followers ?? null, r.loc ?? null, tags, meta],
      );
      ok++;
    } catch(e) { fail++; if(fail<=5) console.error('FAIL', r.handle, e.message); }
  }
  await client.query('COMMIT');
} catch(e) { await client.query('ROLLBACK'); console.error('ROLLBACK', e.message); process.exit(1); }
finally { client.release(); }

console.log(`upserted ok=${ok} fail=${fail}`);
const c = await pool.query(`SELECT count(*)::int n FROM creators WHERE 'fynd-seeding' = ANY(tags)`);
console.log('rows tagged fynd-seeding now in DB:', c.rows[0].n);
const sample = await pool.query(`SELECT handle, display_name, follower_count, primary_city FROM creators WHERE 'fynd-seeding'=ANY(tags) ORDER BY follower_count DESC NULLS LAST LIMIT 5`);
console.log('top 5 by followers:'); sample.rows.forEach(r=>console.log(`  @${r.handle} | ${r.display_name} | ${r.follower_count} | ${r.primary_city}`));
await pool.end();
