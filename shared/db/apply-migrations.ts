// ============================================================
// Minimal migration runner — applies .sql files against BOLTIC_DATABASE_URL.
//
//   npm run db:migrate                       # apply all db/migrations/*.sql in order
//   npm run db:migrate -- 004_phase1_discovery.sql 005_programs.sql
//
// Each file runs in its own transaction. Migrations are written idempotent
// (IF NOT EXISTS / EXCEPTION guards) so re-running is safe.
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';

function findUp(name: string): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envPath = findUp('.env');
if (envPath) dotenv.config({ path: envPath });

const migrationsDir = findUp(path.join('db', 'migrations'));
if (!migrationsDir) {
  console.error('Could not locate db/migrations directory.');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = (args.length > 0 ? args : fs.readdirSync(migrationsDir!))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files to apply.');
    return;
  }

  const pool = getPool();
  for (const file of files) {
    const full = path.join(migrationsDir!, file);
    if (!fs.existsSync(full)) {
      console.log(`✗ ${file} — not found, skipping`);
      continue;
    }
    const sql = fs.readFileSync(full, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`✓ applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`✗ failed ${file}: ${(err as Error).message}`);
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
  }
  await pool.end();
  console.log('\nMigrations complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
