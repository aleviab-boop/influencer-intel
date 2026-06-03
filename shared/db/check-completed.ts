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
  const r = await p.query<{ id: string; brief_id: string | null; target_handle: string; completed_at: string }>(
    `SELECT id, brief_id, target_handle, completed_at FROM scrape_jobs WHERE status='completed' ORDER BY completed_at DESC LIMIT 6`,
  );
  console.log('completed jobs:');
  for (const row of r.rows) {
    console.log(`  ${row.target_handle.padEnd(25)} brief=${row.brief_id ?? 'NULL'}  at=${row.completed_at}`);
  }
  await p.end();
}
main();
