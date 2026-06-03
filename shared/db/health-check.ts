// ============================================================
// Connection health check — verifies BOLTIC_DATABASE_URL works,
// pgvector is available, and our 6 tables exist.
//
// Run with: npx tsx shared/db/health-check.ts
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';

// Walk up from cwd looking for the nearest .env (monorepo root or workspace dir)
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

const REQUIRED_TABLES = [
  'creators',
  'brands',
  'briefs',
  'brief_creators',
  'scrape_jobs',
  'service_accounts',
];

async function main() {
  const pool = getPool();

  console.log('1. Connection…');
  const conn = await pool.query<{ version: string; current_database: string }>(
    `SELECT version() AS version, current_database()`,
  );
  console.log(`   ✓ Connected. ${conn.rows[0]!.version.split(' ').slice(0, 2).join(' ')}`);
  console.log(`     database = ${conn.rows[0]!.current_database}`);

  console.log('2. pgvector extension…');
  const ext = await pool.query<{ extname: string; extversion: string }>(
    `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  if (ext.rows.length === 0) {
    console.log('   ✗ pgvector extension not installed. Vector search will fail.');
    console.log('     Run as DB admin: CREATE EXTENSION IF NOT EXISTS vector;');
  } else {
    console.log(`   ✓ pgvector ${ext.rows[0]!.extversion} present.`);
  }

  console.log('3. Required tables…');
  const found = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name = ANY($1)`,
    [REQUIRED_TABLES],
  );
  const foundNames = new Set(found.rows.map((r) => r.table_name));
  for (const t of REQUIRED_TABLES) {
    console.log(foundNames.has(t) ? `   ✓ ${t}` : `   ✗ ${t} MISSING`);
  }

  console.log('4. Vector column on creators.content_embedding…');
  const vecCol = await pool.query<{ data_type: string; udt_name: string }>(
    `SELECT data_type, udt_name FROM information_schema.columns
     WHERE table_name = 'creators' AND column_name = 'content_embedding'`,
  );
  if (vecCol.rows.length === 0) {
    console.log('   ✗ creators.content_embedding column missing');
  } else {
    console.log(
      `   ✓ creators.content_embedding (${vecCol.rows[0]!.data_type} / ${vecCol.rows[0]!.udt_name})`,
    );
  }

  console.log('5. Boltic encryption helpers (boltic_encrypt / boltic_decrypt)…');
  const fns = await pool.query<{ proname: string }>(
    `SELECT proname FROM pg_proc WHERE proname IN ('boltic_encrypt', 'boltic_decrypt', 'boltic_encrypt_searchable')`,
  );
  if (fns.rows.length === 3) {
    console.log('   ✓ all three encryption functions present');
  } else {
    const have = new Set(fns.rows.map((r) => r.proname));
    console.log('   ⚠ encryption functions:');
    for (const f of ['boltic_encrypt', 'boltic_decrypt', 'boltic_encrypt_searchable']) {
      console.log(have.has(f) ? `     ✓ ${f}` : `     ✗ ${f}`);
    }
  }

  console.log('6. UNIQUE constraints (required for our upserts)…');
  const expectedUnique: { table: string; cols: string[] }[] = [
    { table: 'creators', cols: ['platform', 'handle'] },
    { table: 'brands', cols: ['slug'] },
    { table: 'brief_creators', cols: ['brief_id', 'creator_id'] },
    { table: 'service_accounts', cols: ['platform', 'handle'] },
  ];
  const cons = await pool.query<{
    table_name: string;
    constraint_name: string;
    columns: string;
  }>(
    `SELECT tc.table_name, tc.constraint_name,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS columns
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
       AND tc.table_name = ANY($1)
     GROUP BY tc.table_name, tc.constraint_name`,
    [expectedUnique.map((e) => e.table)],
  );
  const haveUnique = new Set(cons.rows.map((r) => `${r.table_name}:${r.columns}`));
  const missing: { table: string; cols: string[] }[] = [];
  for (const ex of expectedUnique) {
    const key = `${ex.table}:${ex.cols.join(',')}`;
    if (haveUnique.has(key)) {
      console.log(`   ✓ ${ex.table}(${ex.cols.join(',')})`);
    } else {
      console.log(`   ✗ ${ex.table}(${ex.cols.join(',')}) MISSING`);
      missing.push(ex);
    }
  }
  if (missing.length > 0) {
    console.log('\n   Run these in Boltic SQL Editor to fix:');
    for (const m of missing) {
      const cname = `${m.table}_${m.cols.join('_')}_key`;
      console.log(
        `   ALTER TABLE ${m.table} ADD CONSTRAINT ${cname} UNIQUE (${m.cols.join(', ')});`,
      );
    }
  }

  console.log('\nAll done. Ready to read/write.');
  await pool.end();
}

main().catch((err) => {
  console.error('\nHealth check failed:', err.message);
  process.exit(1);
});
