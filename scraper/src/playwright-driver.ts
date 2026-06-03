// ============================================================
// Camoufox-driven Firefox driver — anti-detect browser, no extension
// load. The IG-extraction logic that used to live in our Chrome MV3
// extension content script now lives in page.evaluate (see ig-extract.ts).
//
// Why Camoufox over Chromium:
//   - Hardened Firefox build with anti-fingerprinting baked in
//   - Configurable locale, timezone, proxy, user-agent
//   - Significantly less bot-detection signal vs Playwright Chromium
//   - Plays nicely with Playwright's `firefox` API
// ============================================================

import { firefox, type BrowserContext, type Page } from 'playwright-core';
import { launchOptions } from 'camoufox-js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config.js';

export interface DriverHandle {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

interface CapturedStorageState {
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>;
  origins?: Array<{
    origin: string;
    localStorage?: Array<{ name: string; value: string }>;
  }>;
}

export async function launchDriver(opts: {
  headless?: boolean;
  storageStateJson?: unknown;
} = {}): Promise<DriverHandle> {
  const userDataDir = config.chromeProfilePath; // we keep the same on-disk
                                                // profile path; Firefox just
                                                // creates its own structure
                                                // inside it.
  await fs.mkdir(userDataDir, { recursive: true });

  // Camoufox returns Playwright launch options pre-populated with the right
  // executablePath, args, prefs, fingerprint flags, etc.
  const camoOpts = await launchOptions({
    headless: opts.headless ?? false,
    geoip: true,                    // resolves locale/timezone from the IP
    humanize: true,                 // human-like cursor movement
    locale: ['en-IN', 'en-US'],
    proxy: config.proxyUrl ? { server: config.proxyUrl } : undefined,
    window: [1280, 800],
  });

  // Use launchPersistentContext so the user-data dir survives between runs.
  // Camoufox's options include the executablePath for the bundled Firefox.
  const context = await firefox.launchPersistentContext(userDataDir, {
    ...camoOpts,
    viewport: { width: 1280, height: 800 },
  });

  // Load captured cookies from the service-account session, if any.
  if (opts.storageStateJson && typeof opts.storageStateJson === 'object') {
    const ss = opts.storageStateJson as CapturedStorageState;
    if (ss.cookies && ss.cookies.length > 0) {
      try {
        await context.addCookies(ss.cookies);
      } catch (err) {
        console.warn('[driver] addCookies failed:', (err as Error).message);
      }
    }
    // Hydrate localStorage per-origin (IG sets things like ig_did, csrftoken).
    if (ss.origins) {
      for (const o of ss.origins) {
        if (!o.localStorage || o.localStorage.length === 0) continue;
        try {
          const page = context.pages()[0] ?? (await context.newPage());
          await page.goto(o.origin, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          await page.evaluate((entries: Array<{ name: string; value: string }>) => {
            for (const e of entries) {
              try { localStorage.setItem(e.name, e.value); } catch {}
            }
          }, o.localStorage);
        } catch (err) {
          console.warn(`[driver] localStorage hydrate failed for ${o.origin}:`, (err as Error).message);
        }
      }
    }
  }

  const page = context.pages()[0] ?? (await context.newPage());
  return {
    context,
    page,
    async close() {
      await context.close();
    },
  };
}

/**
 * Navigate to a URL — quick settle (was 3-7s, now 1-2s). Camoufox
 * handles fingerprint stealth; long human-pacing delays at single-account
 * scale are overkill and just slow the pipeline.
 */
export async function navigateHumanly(page: Page, url: string): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1_000 + Math.random() * 1_000);
    return true;
  } catch (err) {
    console.error(`[driver] nav failed: ${url}`, err);
    return false;
  }
}

/** Tight inter-action delay — 0.5-2s. */
export function humanDelay(): Promise<void> {
  const ms = 500 + Math.random() * 1_500;
  return new Promise((r) => setTimeout(r, ms));
}
