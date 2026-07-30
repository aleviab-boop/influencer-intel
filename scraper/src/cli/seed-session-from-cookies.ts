// ============================================================
// CLI: seed-session-from-cookies
// Seeds a service_accounts session for the worker WITHOUT a manual
// headed login, by reusing the cookie-scraper's working IG cookies
// (IG_SESSIONID / IG_DS_USER_ID / IG_CSRFTOKEN from the root .env).
// Builds a Playwright-shaped storageState and upserts the row.
//
// Usage: npx tsx scraper/src/cli/seed-session-from-cookies.ts
//   (reads SERVICE_ACCOUNT_HANDLE + IG_* cookies from .env)
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getBolticClient } from '@influencer-intel/shared/db';

function findEnvPath(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envPath = findEnvPath();
if (envPath) dotenv.config({ path: envPath });

async function main(): Promise<void> {
  const handle = (process.env.SERVICE_ACCOUNT_HANDLE ?? '').trim().toLowerCase();
  const sessionid = (process.env.IG_SESSIONID ?? '').trim();
  const dsUserId = (process.env.IG_DS_USER_ID ?? '').trim();
  const csrftoken = (process.env.IG_CSRFTOKEN ?? '').trim();

  if (!handle) throw new Error('SERVICE_ACCOUNT_HANDLE not set in .env');
  if (!sessionid) throw new Error('IG_SESSIONID not set in .env');
  if (!dsUserId) throw new Error('IG_DS_USER_ID not set in .env');
  if (!csrftoken) throw new Error('IG_CSRFTOKEN not set in .env');

  // Cookies expire roughly when IG sessions do (~1 year for sessionid). We set
  // a conservative 30-day window on the account row regardless.
  const yearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const mkCookie = (name: string, value: string) => ({
    name,
    value,
    domain: '.instagram.com',
    path: '/',
    expires: yearFromNow,
    httpOnly: name === 'sessionid',
    secure: true,
    sameSite: 'Lax' as const,
  });

  const storageState = {
    cookies: [
      mkCookie('sessionid', sessionid),
      mkCookie('ds_user_id', dsUserId),
      mkCookie('csrftoken', csrftoken),
    ],
    origins: [] as Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>,
  };

  const db = getBolticClient();
  const now = new Date().toISOString();
  // IG sessionids live ~1yr; the session-extend cron re-validates and pushes
  // this forward, so 180d is a floor (not a real deadline) that avoids retiring
  // still-valid sessions on a false timer.
  const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  await db.upsert(
    'service_accounts',
    {
      platform: 'instagram',
      handle,
      storage_state: storageState,
      storage_captured_at: now,
      storage_expires_at: expires,
      status: 'active',
      total_scrapes: 0,
      daily_action_count: 0,
      warmed_at: now,
      updated_at: now,
    },
    ['platform', 'handle'],
  );

  // Verify.
  const rows = await db.query<{ handle: string; status: string; has_state: boolean; storage_expires_at: string }>(
    `SELECT handle, status, (storage_state IS NOT NULL) AS has_state, storage_expires_at
       FROM service_accounts WHERE platform = 'instagram' AND handle = $1`,
    [handle],
  );
  const r = rows[0];
  console.log(
    `[seed-session] ${handle}: status=${r?.status} has_state=${r?.has_state} ` +
    `cookies=${storageState.cookies.length} expires=${r?.storage_expires_at}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-session] failed:', (err as Error).message);
  process.exit(1);
});
