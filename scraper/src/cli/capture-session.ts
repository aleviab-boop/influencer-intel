// ============================================================
// CLI: capture-session
// Opens a headed Camoufox Firefox, lets you log in to IG manually,
// then captures the storageState (cookies + localStorage) and saves
// it to the service_accounts row in Boltic Tables.
//
// Usage:
//   npm run capture-session
//   (reads SERVICE_ACCOUNT_HANDLE from .env)
// ============================================================

import dotenv from 'dotenv';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { firefox } from 'playwright-core';
import { launchOptions } from 'camoufox-js';

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

const { getBolticClient } = await import('@influencer-intel/shared/db');
const { config } = await import('../config.js');

async function main() {
  const handle = process.env.SERVICE_ACCOUNT_HANDLE;
  if (!handle) {
    console.error('SERVICE_ACCOUNT_HANDLE env var required (set in .env).');
    process.exit(1);
  }

  // Fresh, isolated profile per capture — no leftover cookies or a different
  // account's session to contaminate this login. This is what caused a session
  // to be saved under the wrong handle (and the stale Facebook tab) before.
  const captureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ig-capture-'));

  console.log(`\n  Opening Camoufox (anti-detect Firefox) on a clean profile.`);
  console.log(`  Profile: ${captureDir}\n`);

  const camoOpts = await launchOptions({
    headless: false,
    geoip: true,
    humanize: true,
    locale: ['en-IN', 'en-US'],
    window: [1280, 800],
  });

  const context = await firefox.launchPersistentContext(captureDir, {
    ...camoOpts,
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] ?? (await context.newPage());
  // Straight to the Instagram login page (not the home page, which can bounce
  // to a stale Facebook/Meta login when there's no session).
  await page.goto('https://www.instagram.com/accounts/login/');

  console.log(`Manual step (one-time):
  1. Log in to Instagram in the Chrome window that just opened, as @${handle}.
  2. Make sure the IG home feed has loaded (proves session is established).
  3. Come back here and press ENTER.\n`);

  await waitForEnter();

  console.log('Capturing storage state…');
  const storageState = await context.storageState();
  const cookieCount = storageState.cookies?.length ?? 0;
  const originCount = storageState.origins?.length ?? 0;
  console.log(`  ${cookieCount} cookies, ${originCount} origin storage entries.`);

  // Sanity check: we want at least the IG sessionid cookie
  const hasSession = (storageState.cookies ?? []).some(
    (c) => c.name === 'sessionid' && c.domain.includes('instagram'),
  );
  if (!hasSession) {
    console.warn('  ⚠ No IG sessionid cookie found. Did the login complete?');
  }

  // Identity guard: confirm the session actually belongs to @handle before we
  // save it under that handle — prevents mislabeling a different account's login.
  let confirmedUser: string | null = null;
  try {
    confirmedUser = await page.evaluate(async () => {
      const r = await fetch('/api/v1/accounts/current_user/?edit=false', {
        headers: { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      if (!r.ok) return null;
      const j = await r.json();
      return (j?.user?.username as string) ?? null;
    });
  } catch {
    /* ignore — fall back to the sessionid check above */
  }
  if (confirmedUser && confirmedUser.toLowerCase() !== handle.toLowerCase()) {
    console.error(`\n  ✗ Logged-in account is @${confirmedUser}, but you asked to save @${handle}.`);
    console.error(`    NOT saving. Log out, log in as @${handle}, and re-run.\n`);
    await context.close().catch(() => {});
    await fsp.rm(captureDir, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }
  if (confirmedUser) console.log(`  ✓ Confirmed logged in as @${confirmedUser}.`);

  console.log('Saving to Boltic service_accounts…');
  const db = getBolticClient();
  await db.upsert(
    'service_accounts',
    {
      platform: 'instagram',
      handle,
      storage_state: storageState,
      storage_captured_at: new Date().toISOString(),
      storage_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      total_scrapes: 0,
      daily_action_count: 0,
      warmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    ['platform', 'handle'],
  );

  await fsp.mkdir(config.chromeProfilePath, { recursive: true });
  const backupPath = path.join(config.chromeProfilePath, `storage-state-${handle}.json`);
  await fsp.writeFile(backupPath, JSON.stringify(storageState, null, 2));
  console.log(`  ✓ Saved to DB + local backup at ${backupPath}\n`);

  await context.close();
  await fsp.rm(captureDir, { recursive: true, force: true }).catch(() => {}); // clean up the throwaway profile
  console.log('Done. Start the scraper with: npm run scraper:dev');
  process.exit(0);
}

function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question('', () => { rl.close(); resolve(); }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
