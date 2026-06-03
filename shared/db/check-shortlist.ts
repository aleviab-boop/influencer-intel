import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';
let dir = process.cwd();
for (let i = 0; i < 6; i++) { const c = path.join(dir, '.env'); if (fs.existsSync(c)) { dotenv.config({ path: c }); break; } const p = path.dirname(dir); if (p === dir) break; dir = p; }
async function main() {
  const p = getPool();
  const briefs = await p.query(`SELECT id, raw_text, status FROM briefs ORDER BY created_at DESC LIMIT 3`);
  console.log('briefs:', briefs.rows);
  for (const b of briefs.rows) {
    const bc = await p.query(`SELECT bc.rank, bc.match_score, c.handle, c.follower_count FROM brief_creators bc JOIN creators c ON c.id = bc.creator_id WHERE bc.brief_id = $1 ORDER BY bc.rank LIMIT 5`, [b.id]);
    console.log(`brief ${b.id.slice(0,8)} creators:`, bc.rows);
  }
  await p.end();
}
main();
