// Boltic created FK columns (brief_id, creator_id, etc.) as VARCHAR(255).
// They contain UUID strings already, so we can safely ALTER them to UUID.
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

const FK_COLS: { table: string; column: string }[] = [
  { table: 'briefs', column: 'brand_id' },
  { table: 'brief_creators', column: 'brief_id' },
  { table: 'brief_creators', column: 'brand_id' },
  { table: 'brief_creators', column: 'creator_id' },
  { table: 'scrape_jobs', column: 'creator_id' },
  { table: 'scrape_jobs', column: 'brief_id' },
  { table: 'scrape_jobs', column: 'assigned_account_id' },
  { table: 'scrape_jobs', column: 'requested_by_brand' },
];

async function main() {
  const p = getPool();
  for (const { table, column } of FK_COLS) {
    try {
      await p.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE UUID USING "${column}"::uuid`,
      );
      console.log(`✓ ${table}.${column} → UUID`);
    } catch (err) {
      console.log(`✗ ${table}.${column}: ${(err as Error).message}`);
    }
  }
  await p.end();
}
main();
