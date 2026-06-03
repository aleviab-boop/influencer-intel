// Add raw_metadata JSONB column to creators table.
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
  try {
    await p.query(`ALTER TABLE creators ADD COLUMN IF NOT EXISTS raw_metadata JSONB`);
    console.log('✓ creators.raw_metadata added');
  } catch (err) {
    console.log('✗', (err as Error).message);
  }
  await p.end();
}
main();
