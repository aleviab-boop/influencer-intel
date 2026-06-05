// ============================================================
// Re-score every creator's Phase 2 quality (followers/engagement/likes/
// comments → 0-100). Run after a scrape batch or after tuning the scorer.
//   npm run db:rescore-quality
//
// Needs BOLTIC_DATABASE_URL. Reads creators in pages, scores in memory,
// writes quality_score / quality_breakdown / quality_band back.
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';
import { scoreCreatorQuality, QUALITY_THRESHOLD } from '../scoring/quality.js';
import type { Creator } from '../types/index.js';

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

const PAGE = 500;

async function main(): Promise<void> {
  const pool = getPool();
  let offset = 0;
  let scored = 0;
  let passed = 0;
  let weak = 0;
  let insufficient = 0;

  console.log(`Re-scoring creator quality (threshold ${QUALITY_THRESHOLD})…\n`);

  for (;;) {
    const { rows } = await pool.query<Creator>(
      `SELECT * FROM creators ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`,
    );
    if (rows.length === 0) break;

    for (const creator of rows) {
      const q = scoreCreatorQuality(creator);
      await pool.query(
        `UPDATE creators SET
           quality_score = $2, quality_breakdown = $3::jsonb,
           quality_band = $4, quality_scored_at = NOW()
         WHERE id = $1`,
        [creator.id, q.score, JSON.stringify(q.breakdown), q.band],
      );
      scored++;
      if (q.band === 'pass') passed++;
      else if (q.band === 'insufficient_data') insufficient++;
      else weak++;
    }

    offset += rows.length;
    process.stdout.write(`  …${scored} scored\r`);
    if (rows.length < PAGE) break;
  }

  console.log(
    `\n\nDone. ${scored} creators scored: ` +
      `${passed} pass (≥${QUALITY_THRESHOLD}), ${weak} weak, ${insufficient} insufficient data.`,
  );
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
