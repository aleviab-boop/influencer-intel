// ============================================================
// Instagram relay — run this on your home machine (residential IP, which
// Instagram allows). Expose it with a free tunnel (ngrok / Cloudflare Tunnel)
// and point the deployed app's IG_RELAY env var at the public URL. The app
// then sends its Instagram requests here, they go out over YOUR connection,
// and the data comes back — so the live crawl works on a cloud server for free.
//
// Run:   RELAY_KEY=somesecret node tools/ig-relay.mjs
// Tunnel: ngrok http 8787        (or: cloudflared tunnel --url http://localhost:8787)
//
// Then on Vercel set:
//   IG_RELAY      = https://<your-tunnel-url>
//   IG_RELAY_KEY  = somesecret   (same value as RELAY_KEY)
// ============================================================

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const KEY = process.env.RELAY_KEY ?? '';
// Only let the relay fetch Instagram — never an arbitrary URL (prevents abuse
// of your connection as an open proxy).
const ALLOWED = /(^|\.)(instagram\.com|cdninstagram\.com|fbcdn\.net)$/i;

const server = http.createServer((req, res) => {
  // Simple health check / browser visit.
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('IG relay is running. POST { url, headers } with x-relay-key.');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('POST only');
    return;
  }
  if (KEY && req.headers['x-relay-key'] !== KEY) {
    res.writeHead(401);
    res.end('unauthorized');
    return;
  }

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy(); // guard
  });
  req.on('end', async () => {
    try {
      const { url, headers } = JSON.parse(body || '{}');
      const u = new URL(url);
      if (!ALLOWED.test(u.hostname)) {
        res.writeHead(400);
        res.end('host not allowed');
        return;
      }
      const upstream = await fetch(url, { headers: headers || {} });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
      console.log(`[relay] ${upstream.status}  ${u.pathname}${u.search.slice(0, 40)}`);
    } catch (e) {
      res.writeHead(502);
      res.end('relay error: ' + (e?.message ?? 'unknown'));
      console.error('[relay] error:', e?.message);
    }
  });
});

server.listen(PORT, () => {
  console.log(`IG relay listening on http://localhost:${PORT}`);
  if (!KEY) console.warn('WARNING: no RELAY_KEY set — anyone who finds the URL can use it. Set RELAY_KEY=... for safety.');
});
