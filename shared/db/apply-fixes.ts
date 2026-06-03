// ============================================================
// Run schema fixes via direct PostgreSQL connection.
// Boltic's SQL Editor blocks DDL; the pg connection allows it
// when the user role is db_admin.
//
// Run with: npm run db:fix
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

const STEPS: { label: string; sql: string }[] = [
  {
    label: 'rename briefs.brand_uuid → brand_id',
    sql: `ALTER TABLE briefs RENAME COLUMN brand_uuid TO brand_id`,
  },
  {
    label: 'add scrape_jobs.started_at',
    sql: `ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  },
  {
    label: 'add scrape_jobs.completed_at',
    sql: `ALTER TABLE scrape_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  },
  {
    label: 'UNIQUE creators(platform, handle)',
    sql: `ALTER TABLE creators ADD CONSTRAINT creators_platform_handle_key UNIQUE (platform, handle)`,
  },
  {
    label: 'UNIQUE brands(slug)',
    sql: `ALTER TABLE brands ADD CONSTRAINT brands_slug_key UNIQUE (slug)`,
  },
  {
    label: 'UNIQUE brief_creators(brief_id, creator_id)',
    sql: `ALTER TABLE brief_creators ADD CONSTRAINT brief_creators_brief_id_creator_id_key UNIQUE (brief_id, creator_id)`,
  },
  {
    label: 'UNIQUE service_accounts(platform, handle)',
    sql: `ALTER TABLE service_accounts ADD CONSTRAINT service_accounts_platform_handle_key UNIQUE (platform, handle)`,
  },
];

async function main() {
  const pool = getPool();
  let applied = 0;
  let alreadyDone = 0;
  let failed = 0;

  for (const step of STEPS) {
    process.stdout.write(`• ${step.label}… `);
    try {
      await pool.query(step.sql);
      console.log('✓');
      applied++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('already exists') ||
        msg.includes('does not exist') ||
        msg.includes('column') && msg.includes('does not exist')
      ) {
        console.log(`(skipped: ${msg.split('\n')[0]})`);
        alreadyDone++;
      } else {
        console.log(`✗  ${msg}`);
        failed++;
      }
    }
  }

  console.log(
    `\nApplied ${applied}, skipped ${alreadyDone}, failed ${failed}.`,
  );
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fix script failed:', err);
  process.exit(1);
});
