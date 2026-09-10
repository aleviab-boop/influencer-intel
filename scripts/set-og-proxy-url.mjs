// Write the current og-proxy tunnel URL into system_config.og_proxy_url so the
// deployed platform's drawer picks it up (cached ~60s) with no Vercel edit or
// redeploy. Called by run-og-relay.sh each time the tunnel (re)starts with a
// fresh URL. This key is SEPARATE from relay_url (the throttle-prone live relay).
//   node scripts/set-og-proxy-url.mjs https://<something>.trycloudflare.com
import pg from 'pg';
import { readFileSync } from 'fs';

const url = (process.argv[2] || '').trim();
if (!/^https?:\/\//.test(url)) {
  console.error('usage: node scripts/set-og-proxy-url.mjs <https-url>');
  process.exit(1);
}
// Reject cloudflared's control-plane host (api.trycloudflare.com) — a loose grep
// on the log can capture it and it 405s every POST, silently killing the drawer.
try {
  const host = new URL(url).hostname;
  if (host === 'api.trycloudflare.com' || host.startsWith('api.')) {
    console.error('refusing bogus og_proxy_url (control-plane host, not a tunnel):', url);
    process.exit(1);
  }
} catch {
  console.error('refusing malformed og_proxy_url:', url);
  process.exit(1);
}
const conn = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/BOLTIC_DATABASE_URL=(.+)/)?.[1]?.trim();
if (!conn) {
  console.error('BOLTIC_DATABASE_URL not found in .env');
  process.exit(1);
}
const u = new URL(conn);
u.searchParams.delete('sslmode');
const c = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(
  `INSERT INTO system_config (key, value, updated_at) VALUES ('og_proxy_url', $1, now())
   ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
  [url],
);
await c.end();
console.log('og_proxy_url set to', url);
