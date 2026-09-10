// ============================================================
// Instagram og: proxy — run this on your home machine (residential IP).
//
// WHY THIS EXISTS (and why it's safe): Instagram serves the public link-preview
// og: tags (follower/post counts, name, pic, per-post likes/comments) to a
// social-crawler User-Agent — but ONLY to residential IPs. From Vercel's
// data-center IP the payload comes back blank, so the profile drawer can't fill
// itself on prod. This proxy forwards ONLY the og: PAGE fetch out over your home
// connection, so the drawer works on the server for free.
//
// This is deliberately a SEPARATE, locked-down service from tools/ig-relay.mjs:
//   - it ONLY fetches instagram.com PROFILE / POST pages (never /api/… — so it
//     structurally cannot hit the rate-limited web_profile_info endpoint),
//   - it forces the crawler UA and STRIPS any Cookie the caller sends (so it can
//     never authenticate / burn a session cookie),
//   => it cannot throttle your accounts or your IP no matter how it's called.
//
// Run:    OG_RELAY_KEY=somesecret node tools/og-relay.mjs
// Tunnel: cloudflared tunnel --protocol http2 --url http://localhost:8788
// (run-og-relay.sh does both + writes the tunnel URL into the DB for you.)
// ============================================================

import http from 'node:http';

const PORT = Number(process.env.OG_PORT ?? 8788);
const KEY = process.env.OG_RELAY_KEY ?? '';
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

// Allow ONLY instagram.com profile pages ( /<handle>/ ) and post pages
// ( /p/<code>/, /reel/<code>/, /tv/<code>/ ). Anything with /api/ or /graphql is
// rejected — that's the whole safety guarantee: this proxy can never be used to
// hit the throttled data endpoints, only the un-throttled link-preview pages.
function isAllowedIgPage(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return false;
  const p = u.pathname;
  if (/\/(api|graphql)(\/|$)/i.test(p)) return false; // never an API path
  // profile page: /handle/  | post pages: /p|reel|tv/<code>/
  return /^\/[A-Za-z0-9._]+\/?$/.test(p) || /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(p);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('IG og: proxy running. POST { url } with x-relay-key. Pages only.');
    return;
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return; }
  if (KEY && req.headers['x-relay-key'] !== KEY) { res.writeHead(401); res.end('unauthorized'); return; }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 100_000) req.destroy(); });
  req.on('end', async () => {
    try {
      const { url } = JSON.parse(body || '{}');
      if (!isAllowedIgPage(url)) { res.writeHead(400); res.end('only instagram profile/post pages allowed'); return; }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      // Force the crawler UA; never forward a Cookie. This is what keeps the proxy
      // incapable of authenticating or burning a session.
      const upstream = await fetch(url, {
        headers: { 'User-Agent': CRAWLER_UA, Accept: 'text/html,application/xhtml+xml' },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(text);
      console.log(`[og] ${upstream.status}  ${new URL(url).pathname}`);
    } catch (e) {
      res.writeHead(502);
      res.end('og proxy error: ' + (e?.message ?? 'unknown'));
      console.error('[og] error:', e?.message);
    }
  });
});

server.listen(PORT, () => {
  console.log(`IG og: proxy listening on http://localhost:${PORT}`);
  if (!KEY) console.warn('WARNING: no OG_RELAY_KEY set — set OG_RELAY_KEY=… so only your app can use it.');
});
