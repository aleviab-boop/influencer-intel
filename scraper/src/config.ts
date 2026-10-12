import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

// Walk up from cwd looking for the nearest .env (monorepo root or workspace dir)
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

// Resolve relative paths against the .env's directory (monorepo root) if found,
// else against cwd. This way EXTENSION_PATH=./scraper/extension works no matter
// which workspace dir the scraper is invoked from.
const envDir = envPath ? path.dirname(envPath) : process.cwd();

function resolvePath(envValue: string | undefined, fallback: string): string {
  const v = envValue ?? fallback;
  return path.isAbsolute(v) ? v : path.resolve(envDir, v);
}

export const config = {
  extensionPath: resolvePath(process.env.EXTENSION_PATH, './scraper/extension'),
  chromeProfilePath: resolvePath(process.env.CHROME_PROFILE_PATH, './.chrome-profile'),
  proxyUrl: process.env.SCRAPER_PROXY_URL || undefined,
  pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000),
  maxActionsPerHour: Number(process.env.MAX_ACTIONS_PER_HOUR ?? 90),
  // Per-account DAILY cap. All accounts egress from ONE fixed office IP, so the
  // IP — not any single account — is what IG throttles. Keeping each account's
  // daily volume low (and the whole pool's combined volume modest) is the only
  // lever left to survive that per-IP throttle. Rolls over 24h after first use.
  maxActionsPerDay: Number(process.env.MAX_ACTIONS_PER_DAY ?? 50),
  // Human-like pause BETWEEN jobs. On a single shared IP a steady machine-gun
  // cadence is exactly what trips the egress throttle; a randomised 30–90s gap
  // spreads requests out so the IP looks like ordinary browsing, not a crawler.
  // Set both to 0 to disable (e.g. when crawling from a clean per-account IP).
  interJobDelayMinMs: Number(process.env.INTER_JOB_DELAY_MIN_MS ?? 30_000),
  interJobDelayMaxMs: Number(process.env.INTER_JOB_DELAY_MAX_MS ?? 90_000),
  // Off-hours guard. The office IP looks most bot-like hammering IG at 3am with
  // no human on the network. When set (e.g. "9-21"), the worker only crawls
  // within these local hours and idles outside them. Empty = crawl any hour.
  crawlHoursLocal: process.env.CRAWL_HOURS_LOCAL ?? '',
  // Proactive rotation: hand off to the least-used ready account after this many
  // jobs, WELL before an account hits its hourly cap — so no single account
  // builds up a burst big enough for IG to flag/kill it. Spreading load thin is
  // what keeps accounts alive; draining one until it dies is what got them
  // killed. 1 = rotate after every job (max spread).
  rotateEveryJobs: Number(process.env.ROTATE_EVERY_JOBS ?? 1),
  // How often the worker re-reads the account pool from the DB, so newly
  // captured / revived accounts join rotation (and removed ones drop) WITHOUT a
  // manual worker restart. Default 3 min.
  poolRefreshMs: Number(process.env.POOL_REFRESH_MS ?? 180_000),
  serviceAccountHandle: process.env.SERVICE_ACCOUNT_HANDLE ?? '',
  platformCallbackUrl:
    process.env.PLATFORM_CALLBACK_URL ?? 'http://localhost:3030/api/scrape-callback',
  callbackSecret: process.env.SCRAPER_CALLBACK_SECRET ?? '',
};

export function assertConfig(): void {
  if (!config.serviceAccountHandle) {
    throw new Error(
      'SERVICE_ACCOUNT_HANDLE not set. Add to .env or run capture-session first.',
    );
  }
  if (!fs.existsSync(config.extensionPath)) {
    throw new Error(
      `Extension path not found: ${config.extensionPath}. Set EXTENSION_PATH in .env.`,
    );
  }
}
