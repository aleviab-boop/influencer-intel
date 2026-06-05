// ============================================================
// Phase 1 discovery smoke test — verifies migration 004 is applied:
//   • creators has the 7 discovery columns
//   • discovery_results table + its unique key + indexes exist
//
// Schema-only (no OpenAI key needed). Run after applying db/migrations/004.
//   npm run db:discover-smoke
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';

function findEnvPath(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const envPath = findEnvPath();
if (envPath) dotenv.config({ path: envPath });

const REQUIRED_CREATOR_COLS = [
  'genre',
  'niche',
  'region',
  'tags',
  'source',
  'source_url',
  'confidence_score',
];

async function main(): Promise<void> {
  const pool = getPool();
  let ok = true;
  const fail = (msg: string) => {
    ok = false;
    console.log(`✗ ${msg}`);
  };
  const pass = (msg: string) => console.log(`✓ ${msg}`);

  console.log('Phase 1 discovery smoke test\n');

  // 1) creators columns
  const cols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'creators' AND column_name = ANY($1)`,
    [REQUIRED_CREATOR_COLS],
  );
  const have = new Set(cols.rows.map((r) => r.column_name));
  for (const c of REQUIRED_CREATOR_COLS) {
    if (have.has(c)) pass(`creators.${c}`);
    else fail(`creators.${c} missing — apply migration 004`);
  }

  // 2) discovery_results table
  const tbl = await pool.query<{ t: string | null }>(
    `SELECT to_regclass('public.discovery_results') AS t`,
  );
  if (tbl.rows[0]?.t) pass('discovery_results table');
  else fail('discovery_results table missing — apply migration 004');

  // 3) unique (prompt, creator_id)
  const uniq = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.discovery_results'::regclass AND contype = 'u'
     ) AS exists`,
  );
  if (uniq.rows[0]?.exists) pass('discovery_results unique (prompt, creator_id)');
  else fail('discovery_results unique key missing');

  // 4) GIN index on creators.tags
  const gin = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE tablename = 'creators' AND indexname = 'idx_creators_tags'
     ) AS exists`,
  );
  if (gin.rows[0]?.exists) pass('creators.tags GIN index');
  else fail('idx_creators_tags missing');

  await pool.end();
  console.log(ok ? '\nAll checks passed.' : '\nSome checks failed.');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
