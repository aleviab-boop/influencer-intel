// ============================================================
// Home-IP og-proxy health signal — a "smoke detector" for the residential proxy.
//
// Instagram only serves the public og: tags to residential IPs, so the platform
// routes those page fetches through a home-IP cloudflared tunnel (system_config.
// og_proxy_url). That tunnel can silently die (host sleeps, tunnel churns without
// re-registering) — and when it does, avatars/engagement quietly stop filling
// with no error surfaced anywhere.
//
// This does ONE free og fetch of a known-good handle and records the result in
// system_config, turning a silent failure into a queryable timestamp. It never
// touches Apify and never hits web_profile_info — it's the same cookieless path
// the fetcher already uses, so it costs one page fetch and two tiny config
// writes. It does NOT try to restart anything (that's the on-host keeper's job);
// it only makes "the proxy went dark at HH:MM" visible.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { ogFetch, ogMeta } from './og-proxy';

// A high-profile, always-public handle whose og page reliably carries a
// "<n> Followers" line — the presence of that line is our "real IG data" proof
// (a dead tunnel can return a 200 "tunnel not found" page, which has no such line).
const CANARY_HANDLE = 'nasa';
const OK_KEY = 'og_proxy_last_ok_at';       // ISO timestamp of last successful canary
const STATUS_KEY = 'og_proxy_last_status';  // 'ok' | 'fail'

export interface OgProxyCanaryResult {
  ok: boolean;
  followers: number | null; // parsed count on success, null on failure
  checked_at: string;       // ISO
}

// "104M" / "2,990" / "1.2K" → number. Local copy so this module is standalone.
function parseCountToken(t: string): number {
  const s = t.trim().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*([KMB]?)$/i);
  if (!m) return 0;
  let n = parseFloat(m[1] ?? '0');
  const suf = (m[2] || '').toUpperCase();
  if (suf === 'K') n *= 1e3; else if (suf === 'M') n *= 1e6; else if (suf === 'B') n *= 1e9;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function writeConfig(key: string, value: string): Promise<void> {
  try {
    await getBolticClient().query(
      `INSERT INTO system_config (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, value],
    );
  } catch {
    /* best-effort — a failed health write must never break the caller */
  }
}

// Run the canary: one free og fetch, verify it carries real IG data, and stamp
// the result into system_config. Returns the outcome; never throws.
export async function runOgProxyCanary(): Promise<OgProxyCanaryResult> {
  const checked_at = new Date().toISOString();
  let followers: number | null = null;
  try {
    const body = await ogFetch(`https://www.instagram.com/${CANARY_HANDLE}/`, 10_000);
    const desc = body ? ogMeta(body, 'og:description') : null;
    const fm = desc?.match(/([\d.,KMB]+)\s+Followers/i);
    if (fm) followers = parseCountToken(fm[1] ?? '');
  } catch {
    followers = null;
  }
  const ok = followers != null && followers > 0;
  await writeConfig(STATUS_KEY, ok ? 'ok' : 'fail');
  if (ok) await writeConfig(OK_KEY, checked_at); // only advance the "last OK" clock on success
  return { ok, followers, checked_at };
}

export interface OgProxyHealth {
  ok: boolean;                 // last canary passed
  last_ok_at: string | null;   // ISO of last successful canary
  minutes_stale: number | null; // minutes since last_ok_at (null if never)
  proxy_url_configured: boolean;
}

// Read-only health snapshot for a status endpoint. Cheap: three config reads.
export async function readOgProxyHealth(): Promise<OgProxyHealth> {
  const db = getBolticClient();
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM system_config WHERE key IN ($1, $2, 'og_proxy_url')`,
    [OK_KEY, STATUS_KEY],
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const lastOk = map.get(OK_KEY)?.trim() || null;
  const status = map.get(STATUS_KEY)?.trim() || null;
  const proxyUrl = map.get('og_proxy_url')?.trim() || null;
  const minutesStale = lastOk
    ? Math.max(0, Math.round((Date.now() - new Date(lastOk).getTime()) / 60_000))
    : null;
  return {
    ok: status === 'ok',
    last_ok_at: lastOk,
    minutes_stale: minutesStale,
    proxy_url_configured: !!proxyUrl,
  };
}
