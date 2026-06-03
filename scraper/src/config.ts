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
  maxActionsPerHour: Number(process.env.MAX_ACTIONS_PER_HOUR ?? 300),
  serviceAccountHandle: process.env.SERVICE_ACCOUNT_HANDLE ?? '',
  platformCallbackUrl:
    process.env.PLATFORM_CALLBACK_URL ?? 'http://localhost:3000/api/scrape-callback',
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
