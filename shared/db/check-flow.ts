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
  const pool = getPool();
  const j = await pool.query<{ job_type: string; status: string; count: string }>(
    `SELECT job_type, status, COUNT(*)::int AS count FROM scrape_jobs GROUP BY 1,2 ORDER BY 1,2`,
  );
  console.log('scrape_jobs by type+status:', j.rows);
  const recent = await pool.query<{ id: string; job_type: string; status: string; target_handle: string; attempts: number }>(
    `SELECT id, job_type, status, target_handle, attempts FROM scrape_jobs ORDER BY queued_at DESC LIMIT 8`,
  );
  console.log('most recent jobs:', recent.rows);
  const c = await pool.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM creators`);
  console.log('creators:', c.rows[0]);
  const b = await pool.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM briefs`);
  console.log('briefs:', b.rows[0]);
  await pool.end();
}
main();
