// ============================================================
// CLI: recompute credibility for all active creators using the new
// signal-based scorer. Replaces the old hardcoded "80 for everyone".
//
//   npx tsx src/cli/recompute-credibility.ts
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

function findEnvPath(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const c = path.join(dir, '.env');
    if (fs.existsSync(c)) return c;
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  return null;
}
const envPath = findEnvPath();
if (envPath) dotenv.config({ path: envPath });

const { getPool } = await import('@influencer-intel/shared/db');
const { computeCredibilityFromExtraction } = await import('../jobs/credibility-scorer.js');

interface Row {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  follower_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  is_verified: boolean | null;
  raw_metadata: { vision?: Record<string, unknown> } | null;
}

async function main() {
  const pool = getPool();
  const all = await pool.query<Row>(
    `SELECT id::text, handle, display_name, bio, follower_count, following_count,
            posts_count, is_verified, raw_metadata
     FROM creators
     WHERE is_active = true AND last_scraped_at IS NOT NULL`,
  );
  console.log(`recomputing credibility for ${all.rows.length} creators…`);

  const distribution = { green: 0, amber: 0, red: 0 };
  let i = 0;
  for (const r of all.rows) {
    const fakeExtraction: any = {
      handle: r.handle,
      platform_user_id: null,
      display_name: r.display_name,
      bio: r.bio,
      profile_photo_url: null,
      is_verified: !!r.is_verified,
      follower_count: r.follower_count,
      following_count: r.following_count,
      posts_count: r.posts_count,
      recent_posts: [],
      hashtags_seen: [],
      extracted_at: new Date().toISOString(),
    };
    const vision = (r.raw_metadata?.vision as any) ?? null;
    const credibility = computeCredibilityFromExtraction(fakeExtraction, vision);
    distribution[credibility.badge]++;
    await pool.query(
      `UPDATE creators SET credibility = $1::jsonb WHERE id = $2`,
      [JSON.stringify(credibility), r.id],
    );
    i++;
    if (i % 50 === 0) console.log(`  ${i}/${all.rows.length}`);
  }
  console.log('done.');
  console.log('badge distribution:', distribution);

  // Show new score histogram
  const hist = await pool.query<{ band: string; n: number }>(
    `SELECT
       CASE
         WHEN (credibility->>'overall_score')::int >= 90 THEN '90-100'
         WHEN (credibility->>'overall_score')::int >= 80 THEN '80-89'
         WHEN (credibility->>'overall_score')::int >= 70 THEN '70-79'
         WHEN (credibility->>'overall_score')::int >= 60 THEN '60-69'
         WHEN (credibility->>'overall_score')::int >= 50 THEN '50-59'
         WHEN (credibility->>'overall_score')::int >= 40 THEN '40-49'
         ELSE '<40'
       END AS band,
       COUNT(*)::int AS n
     FROM creators WHERE is_active AND credibility IS NOT NULL
     GROUP BY 1 ORDER BY 1 DESC`,
  );
  console.log('score distribution:');
  for (const row of hist.rows) console.log(`  ${row.band}: ${row.n}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
