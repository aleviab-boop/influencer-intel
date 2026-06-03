import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';
let dir = process.cwd();
for (let i = 0; i < 6; i++) {
  const c = path.join(dir, '.env');
  if (fs.existsSync(c)) { dotenv.config({ path: c }); break; }
  const p = path.dirname(dir);
  if (p === dir) break;
  dir = p;
}
async function main() {
  const p = getPool();
  const r = await p.query<Record<string, unknown>>(
    `SELECT handle, follower_count::text AS fc, engagement_rate,
       (raw_metadata->'geo'->>'engagement_rate')::float AS er,
       (raw_metadata->'geo'->>'posts_per_week')::float AS ppw,
       (raw_metadata->'geo'->>'last_post_at') AS last_post,
       jsonb_array_length(COALESCE(raw_metadata->'geo'->'top_hashtags', '[]'::jsonb)) AS hashtag_count,
       credibility->>'overall_score' AS cred
     FROM creators
     WHERE last_scraped_at > NOW() - INTERVAL '5 minutes'
       AND is_active = true AND follower_count >= 5000
     ORDER BY last_scraped_at DESC LIMIT 8`,
  );
  console.log('Recently scraped ≥5K creators with new signals:');
  for (const row of r.rows) console.log(' ', row);
  await p.end();
}
main();
