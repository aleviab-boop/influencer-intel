// Manually invoke the platform's discovery + ranker for a brief.
// Reveals which step is filtering out our scraped creators.
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool, getBolticClient } from './boltic-client.js';

let dir = process.cwd();
for (let i = 0; i < 6; i++) {
  const c = path.join(dir, '.env');
  if (fs.existsSync(c)) { dotenv.config({ path: c }); break; }
  const p = path.dirname(dir);
  if (p === dir) break;
  dir = p;
}

const BRIEF_ID = process.argv[2] ?? 'c8cf9210-02c8-426b-9861-b3d02c2fd962';

async function main() {
  const pool = getPool();
  const db = getBolticClient();
  const brief = await db.findById<{ id: string; brief_embedding: number[] | null; parsed_spec: unknown }>('briefs', BRIEF_ID);
  if (!brief) { console.log('brief not found'); return; }
  console.log('brief.brief_embedding type:', typeof brief.brief_embedding, Array.isArray(brief.brief_embedding) ? `[${brief.brief_embedding.length}]` : '');
  console.log('brief.parsed_spec:', brief.parsed_spec);

  const allCreators = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int FROM creators WHERE is_active = true`,
  );
  console.log('total active creators:', allCreators.rows[0]);

  const allCreatorsList = await pool.query<{ handle: string; last_scraped_at: string | null; embedding_dim: number | null }>(
    `SELECT handle, last_scraped_at, array_length(content_embedding::real[], 1) AS embedding_dim FROM creators ORDER BY last_scraped_at DESC NULLS LAST LIMIT 10`,
  );
  console.log('recent creators:', allCreatorsList.rows);

  if (brief.brief_embedding && Array.isArray(brief.brief_embedding)) {
    const matches = await db.vectorSearch<{ handle: string; similarity: number; last_scraped_at: string | null }>(
      'creators',
      'content_embedding',
      brief.brief_embedding,
      10,
      { sql: 'is_active = true', params: [] },
    );
    console.log('vector search matches:', matches);
  } else {
    console.log('SKIP vector search — brief_embedding not parseable');
  }

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
