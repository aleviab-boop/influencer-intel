// Write the current relay/tunnel URL into system_config.relay_url so the
// deployed platform picks it up (cached ~60s) with no Vercel edit or redeploy.
// Called by relay-daemon.sh each time the tunnel (re)starts with a fresh URL.
//   node scripts/set-relay-url.mjs https://<something>.trycloudflare.com
import pg from 'pg';
import { readFileSync } from 'fs';

const url = (process.argv[2] || '').trim();
if (!/^https?:\/\//.test(url)) {
  console.error('usage: node scripts/set-relay-url.mjs <https-url>');
  process.exit(1);
}
// Guard: cloudflared's log mentions `api.trycloudflare.com` (its control-plane
// endpoint) on the SAME lines as the real quick-tunnel URL, so a loose grep can
// capture it. That host returns HTTP 405 to relay POSTs and silently kills live
// data. The real quick-tunnel host is a random multi-word subdomain, never
// `api.`. Reject it here so a bad grep can never poison the DB mid-demo.
try {
  const host = new URL(url).hostname;
  if (host === 'api.trycloudflare.com' || host.startsWith('api.')) {
    console.error('refusing bogus relay_url (control-plane host, not a tunnel):', url);
    process.exit(1);
  }
} catch {
  console.error('refusing malformed relay_url:', url);
  process.exit(1);
}
const conn = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/BOLTIC_DATABASE_URL=(.+)/)?.[1]?.trim();
if (!conn) {
  console.error('BOLTIC_DATABASE_URL not found in .env');
  process.exit(1);
}
const c = new pg.Client({ connectionString: conn });
await c.connect();
await c.query(
  `INSERT INTO system_config (key, value, updated_at) VALUES ('relay_url', $1, now())
   ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
  [url],
);
await c.end();
console.log('relay_url set to', url);
