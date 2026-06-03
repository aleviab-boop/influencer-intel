// ============================================================
// End-to-end smoke test:
//   1. Connect to Boltic
//   2. Verify OpenAI key works (embed + parse)
//   3. Upsert the "Trends" demo brand
//   4. Insert a test brief with embedding
//   5. Vector search creators (will be empty until scraper runs)
//   6. Clean up
//
// Run with: npm run db:smoke
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool, getBolticClient } from './boltic-client.js';
import { getOpenAIClient } from '../llm/openai-client.js';

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

async function main() {
  const db = getBolticClient();
  const llm = getOpenAIClient();

  console.log('1. DB connection…');
  await db.query('SELECT 1');
  console.log('   ✓');

  console.log('2. OpenAI embedding (text-embedding-3-small)…');
  const sample = 'Festive Diwali campaign for ghee skincare, women 25-34, Mumbai';
  const t0 = Date.now();
  const vec = await llm.embed(sample);
  console.log(`   ✓ embed dim=${vec.length} in ${Date.now() - t0}ms`);

  console.log('3. OpenAI brief parse (gpt-4o-mini, JSON mode)…');
  const t1 = Date.now();
  const parsed = await llm.parseBrief(sample);
  console.log(
    `   ✓ parse in ${Date.now() - t1}ms — category=${parsed.category} cities=[${parsed.target_cities.join(',')}]`,
  );

  console.log('4. Get-or-insert Trends brand…');
  let trendsRows = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM brands WHERE slug = 'trends' LIMIT 1`,
  );
  if (trendsRows.length === 0) {
    trendsRows = await db.query<{ id: string; name: string }>(
      `INSERT INTO brands (name, slug, category, plan, research_quota_used, research_quota_max, onboarded_at)
       VALUES ('Trends', 'trends', 'fashion', 'design_partner', 0, 50, NOW())
       RETURNING id, name`,
    );
  }
  console.log(`   ✓ brand_id=${trendsRows[0]!.id}`);

  console.log('5. Insert smoke-test brief with embedding…');
  const briefRows = await db.query<{ id: string }>(
    `INSERT INTO briefs (brand_id, raw_text, parsed_spec, brief_embedding, status, parsed_at)
     VALUES ($1, $2, $3, $4::vector, 'parsed', NOW())
     RETURNING id`,
    [trendsRows[0]!.id, sample, JSON.stringify(parsed), `[${vec.join(',')}]`],
  );
  const briefId = briefRows[0]!.id;
  console.log(`   ✓ brief_id=${briefId}`);

  console.log('6. Vector search creators (empty until scraper runs)…');
  const matches = await db.vectorSearch(
    'creators',
    'content_embedding',
    vec,
    5,
    { sql: 'is_active = true', params: [] },
  );
  console.log(`   ✓ matches found: ${matches.length}`);

  console.log('7. Cleanup smoke-test brief…');
  await db.query('DELETE FROM briefs WHERE id = $1', [briefId]);
  console.log('   ✓');

  console.log('\nAll checks passed. End-to-end DB + LLM are wired.');
  await getPool().end();
}

main().catch((err) => {
  console.error('\nSmoke test failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
