// One-off: measure how many sheet handles exist in DB and how much content we already have.
require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

function normHandle(h) {
  return String(h || '').trim().replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
}

async function main() {
  const csv = fs.readFileSync(process.argv[2], 'utf8');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = lines.shift();
  const handles = [];
  for (const line of lines) {
    const first = line.split(',')[0];
    const h = normHandle(first);
    if (h) handles.push(h);
  }
  const uniq = [...new Set(handles)];
  console.log('sheet handles:', handles.length, 'unique:', uniq.length);

  const client = new Client({ connectionString: process.env.BOLTIC_DATABASE_URL, ssl: false });
  await client.connect();

  const { rows } = await client.query(
    `SELECT lower(handle) AS handle,
            follower_count,
            (bio IS NOT NULL AND length(bio) > 0) AS has_bio,
            (recent_posts IS NOT NULL AND jsonb_array_length(recent_posts::jsonb) > 0) AS has_posts,
            (audience_demographics IS NOT NULL) AS has_demo,
            (primary_city IS NOT NULL OR region IS NOT NULL) AS has_loc
     FROM creators
     WHERE lower(handle) = ANY($1)`,
    [uniq],
  );

  const inDb = new Set(rows.map((r) => r.handle));
  const withContent = rows.filter((r) => r.has_bio || r.has_posts);
  const withDemo = rows.filter((r) => r.has_demo);
  const withLoc = rows.filter((r) => r.has_loc);
  const withFollowers = rows.filter((r) => Number(r.follower_count) > 0);

  console.log('in DB:              ', inDb.size);
  console.log('  with bio or posts:', withContent.length);
  console.log('  with demographics:', withDemo.length);
  console.log('  with location:    ', withLoc.length);
  console.log('  with followers>0: ', withFollowers.length);
  console.log('NOT in DB:          ', uniq.length - inDb.size);

  // content but no cached demo => can infer for FREE right now
  const inferable = rows.filter((r) => (r.has_bio || r.has_posts) && !r.has_demo);
  console.log('inferable now (content, no demo):', inferable.length);

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
