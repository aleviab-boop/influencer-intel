import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';
let dir = process.cwd();
for (let i = 0; i < 6; i++) { const c = path.join(dir, '.env'); if (fs.existsSync(c)) { dotenv.config({ path: c }); break; } const p = path.dirname(dir); if (p === dir) break; dir = p; }
async function main() {
  const p = getPool();
  const r = await p.query("UPDATE scrape_jobs SET status='queued', attempts=0, error_message=NULL, started_at=NULL, completed_at=NULL WHERE status IN ('failed','in_progress')");
  console.log('reset rows:', r.rowCount);
  const counts = await p.query("SELECT status, COUNT(*)::int FROM scrape_jobs GROUP BY 1 ORDER BY 1");
  console.log('after:', counts.rows);
  await p.end();
}
main();
