// Diagnostic: launch with seeded session, navigate to a profile, dump what
// page we actually landed on (og tags, title, url, login markers) + screenshot.
import { getBolticClient } from '@influencer-intel/shared/db';
import type { ServiceAccount } from '@influencer-intel/shared/types';
import { config, assertConfig } from '../config.js';
import { launchDriver } from '../playwright-driver.js';
import { navigateHumanly } from '../playwright-driver.js';

async function main(): Promise<void> {
  const handle = (process.argv[2] ?? 'instagram').trim().toLowerCase();
  assertConfig();
  const db = getBolticClient();
  const accounts = await db.query<ServiceAccount>(
    `SELECT * FROM service_accounts WHERE platform='instagram' AND handle=$1 AND status='active' ORDER BY storage_captured_at DESC NULLS LAST LIMIT 1`,
    [config.serviceAccountHandle],
  );
  const account = accounts[0];
  if (!account) throw new Error('no account');
  const driver = await launchDriver({ headless: false, storageStateJson: account.storage_state });
  const before = await driver.context.cookies('https://www.instagram.com');
  console.log('COOKIES_BEFORE=' + JSON.stringify(before.map((c) => ({ name: c.name, domain: c.domain, len: String(c.value).length, expires: c.expires }))));
  const ok = await navigateHumanly(driver.page, `https://www.instagram.com/${handle}/`);
  await new Promise((r) => setTimeout(r, 3000));
  const diag = await driver.page.evaluate(() => {
    const g: any = globalThis; if (typeof g.__name !== 'function') g.__name = (fn: unknown) => fn;
    const meta = (p: string) => (document.querySelector(`meta[property="${p}"]`)?.getAttribute('content') ?? null);
    const body = document.body.innerText.slice(0, 600);
    return {
      url: window.location.href,
      title: document.title,
      og_title: meta('og:title'),
      og_description: meta('og:description'),
      has_login_form: !!document.querySelector('input[name="username"], input[name="password"]'),
      has_header_section: !!document.querySelector('header section'),
      body_snippet: body,
    };
  });
  console.log('NAVOK=' + ok);
  console.log('DIAG=' + JSON.stringify(diag));
  await driver.page.screenshot({ path: '/tmp/ig-diag.png', fullPage: false }).catch(() => {});
  await driver.close().catch(() => {});
  process.exit(0);
}
main().catch((e) => { console.error('DIAG_FATAL=' + (e as Error).message); process.exit(1); });
