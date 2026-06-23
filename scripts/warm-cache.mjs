// Slow background cache-warmer for creator profiles.
//
// Instagram rate-limits the login-free crawl, so opening creators rapidly gets
// the IP blocked and their posts never load. This walks your creators ONE AT A
// TIME with a delay, hitting /api/ig-profile (which crawls from your home IP and
// caches the recent posts into the shared DB). Once cached, the profile drawer
// and the one-pager show real posts even when Instagram is throttling — and
// because the DB is shared, the deployed site benefits too.
//
// Usage (from the repo root, with the dev server running on :3030):
//   node scripts/warm-cache.mjs                 # curated creators, 8s apart
//   node scripts/warm-cache.mjs --city=pune     # only creators in a city
//   node scripts/warm-cache.mjs --all           # all active creators (big!)
//   node scripts/warm-cache.mjs --delay=12 --limit=40 --force
//
// Env: WARM_BASE (default http://localhost:3030), BOLTIC_DATABASE_URL (from .env)

import pg from 'pg';
import fs from 'node:fs';

// ---- load .env (try platform/.env then ./.env) ----
for (const p of ['./platform/.env', './.env']) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---- args ----
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const BASE = process.env.WARM_BASE || 'http://localhost:3030';
const DELAY = Math.max(2, Number(args.delay) || 8) * 1000;
const LIMIT = Number(args.limit) || 60;
const FORCE = Boolean(args.force);
const CITY = typeof args.city === 'string' ? args.city.toLowerCase() : null;
const ALL = Boolean(args.all);

let conn = process.env.BOLTIC_DATABASE_URL;
if (!conn) { console.error('Missing BOLTIC_DATABASE_URL'); process.exit(1); }
try { const u = new URL(conn); u.searchParams.delete('sslmode'); conn = u.toString(); } catch { /* ignore */ }
const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

const where = ["platform = 'instagram'", 'is_active = true'];
if (!ALL) where.push("source = 'manual'"); // default: your curated list
if (CITY) where.push(`lower(coalesce(region,'') || ' ' || coalesce(primary_city,'')) like '%${CITY.replace(/[^a-z0-9 ]/g, '')}%'`);
if (!FORCE) where.push("NOT (raw_metadata ? 'recent_posts')"); // skip already-cached

const sql = `select handle from creators where ${where.join(' and ')}
             order by follower_count desc nulls last limit ${LIMIT}`;
const rows = await pool.query(sql);
const handles = rows.rows.map((r) => r.handle).filter(Boolean);

console.log(`Warming ${handles.length} creators via ${BASE} (${DELAY / 1000}s apart, ${FORCE ? 'force' : 'skip-cached'})`);
if (handles.length === 0) { console.log('Nothing to warm — all cached, or no matches.'); await pool.end(); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, blocked = 0, consecutiveBlocked = 0;

for (let i = 0; i < handles.length; i++) {
  const h = handles[i];
  let posts = 0, errored = false;
  try {
    const d = await fetch(`${BASE}/api/ig-profile?handle=${encodeURIComponent(h)}&_t=${Date.now()}`).then((r) => r.json());
    posts = Array.isArray(d.recent) ? d.recent.length : 0;
  } catch { errored = true; }

  if (posts > 0) { ok++; consecutiveBlocked = 0; console.log(`  [${i + 1}/${handles.length}] @${h} ✓ cached ${posts} posts`); }
  else { blocked++; consecutiveBlocked++; console.log(`  [${i + 1}/${handles.length}] @${h} ✗ ${errored ? 'error' : 'no posts (throttled)'}`); }

  // Back off hard if Instagram starts blocking, so we don't dig the hole deeper.
  if (consecutiveBlocked >= 3) {
    const cool = 90;
    console.log(`  …${consecutiveBlocked} blocked in a row — cooling down ${cool}s before continuing`);
    await sleep(cool * 1000);
    consecutiveBlocked = 0;
  } else if (i < handles.length - 1) {
    await sleep(DELAY);
  }
}

console.log(`\nDone. Cached: ${ok}  ·  Throttled/failed: ${blocked}`);
if (blocked > ok) console.log('Instagram is throttling heavily right now — re-run later; cached ones are saved.');
await pool.end();
process.exit(0);
