import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';
let dir = process.cwd();
for (let i = 0; i < 6; i++) { const c = path.join(dir, '.env'); if (fs.existsSync(c)) { dotenv.config({ path: c }); break; } const p = path.dirname(dir); if (p === dir) break; dir = p; }
async function main() {
  const p = getPool();
  const r = await p.query(`SELECT handle, display_name, follower_count, posts_count, bio, length(profile_photo_url) AS photo_url_len FROM creators ORDER BY first_indexed_at DESC LIMIT 10`);
  console.log('creators:', r.rows);
  await p.end();
}
main();
