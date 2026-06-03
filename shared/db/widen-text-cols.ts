// Convert all VARCHAR(n) columns on our 6 tables to TEXT.
// Boltic's table builder defaults text columns to VARCHAR(255); IG profile
// photo URLs are 400+ chars and overflow. TEXT has no limit.
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

const TABLES = ['creators', 'brands', 'briefs', 'brief_creators', 'scrape_jobs', 'service_accounts'];

async function main() {
  const p = getPool();
  let total = 0;
  for (const t of TABLES) {
    const r = await p.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name=$1 AND data_type='character varying'`,
      [t],
    );
    for (const row of r.rows) {
      const sql = `ALTER TABLE "${t}" ALTER COLUMN "${row.column_name}" TYPE TEXT`;
      try {
        await p.query(sql);
        console.log(`✓ ${t}.${row.column_name} → TEXT`);
        total++;
      } catch (err) {
        console.log(`✗ ${t}.${row.column_name}: ${(err as Error).message}`);
      }
    }
  }
  console.log(`\nTotal columns widened: ${total}`);
  await p.end();
}
main();
