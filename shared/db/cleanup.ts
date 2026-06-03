// Wipe low-quality LLM-hallucinated creator stubs and stale jobs.
// Use after switching to hashtag-based discovery.
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

  // Clean up brief_creators referring to bad data
  const bc = await p.query(`DELETE FROM brief_creators WHERE rank IS NOT NULL`);
  console.log(`removed ${bc.rowCount} brief_creator rows`);

  // Wipe creators with <5K followers OR null followers (incomplete scrapes)
  const cr = await p.query(
    `DELETE FROM creators WHERE follower_count IS NULL OR follower_count < 5000`,
  );
  console.log(`removed ${cr.rowCount} low-quality creators`);

  // Wipe scrape jobs (we'll regenerate fresh from briefs)
  const sj = await p.query(`DELETE FROM scrape_jobs`);
  console.log(`removed ${sj.rowCount} stale scrape jobs`);

  // Reset briefs to 'parsed' so re-submitting via UI re-runs discovery
  const br = await p.query(`UPDATE briefs SET status = 'parsed'`);
  console.log(`reset ${br.rowCount} briefs to 'parsed'`);

  await p.end();
}
main();
