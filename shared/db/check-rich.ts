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
  const j = await p.query<{ job_type: string; status: string; count: number }>(
    `SELECT job_type, status, COUNT(*)::int AS count FROM scrape_jobs GROUP BY 1,2 ORDER BY 1,2`,
  );
  console.log('jobs:', j.rows);
  const c = await p.query<Record<string, unknown>>(
    `SELECT handle, follower_count, posts_count, primary_category,
            raw_metadata->>'tier' AS tier,
            raw_metadata->'vision'->>'niche' AS niche,
            raw_metadata->'vision'->>'visual_quality_score' AS visual_quality
     FROM creators
     ORDER BY first_indexed_at DESC NULLS LAST
     LIMIT 12`,
  );
  console.log('top creators:', c.rows);
  const bc = await p.query<Record<string, unknown>>(
    `SELECT bc.rank, bc.match_score, c.handle, c.follower_count, c.is_verified, c.primary_category
     FROM brief_creators bc JOIN creators c ON c.id = bc.creator_id
     ORDER BY bc.rank LIMIT 10`,
  );
  console.log('shortlist:', bc.rows);
  await p.end();
}
main();
