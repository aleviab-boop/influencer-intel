// ============================================================
// Orchestrator — main scraper loop.
// ============================================================

import type { Page } from 'playwright-core';
import type { ScrapeJob } from '@influencer-intel/shared/types';
import { config, assertConfig } from './config.js';
import { JobQueue } from './queue/worker.js';
import { AccountPool } from './queue/account-pool.js';
import { launchDriver, type DriverHandle } from './playwright-driver.js';
import { handleDiscoveryCrawl } from './jobs/discovery-scraper.js';
import { handleAudienceInference } from './jobs/audience-inference.js';
import { handleCredibilityRecompute } from './jobs/credibility-scorer.js';
import { handleSearchQuery } from './jobs/search-discovery.js';
import { notifyPlatform } from './platform-notify.js';

// One cheap authenticated probe to see if the active account is being
// rate-limited (429). Run between jobs so we can rotate off a throttled account.
async function probeThrottled(page: Page): Promise<boolean> {
  try {
    const status = await page.evaluate(async () => {
      const g = globalThis as unknown as { __name?: (fn: unknown) => unknown };
      if (typeof g.__name !== 'function') g.__name = (fn: unknown) => fn;
      try {
        const r = await fetch('/api/v1/users/web_profile_info/?username=instagram', {
          headers: { 'X-IG-App-ID': '936619743392459' },
          credentials: 'include',
        });
        return r.status;
      } catch {
        return 0;
      }
    });
    return status === 429;
  } catch {
    return false;
  }
}

export async function run(): Promise<void> {
  assertConfig();

  console.log('[orchestrator] starting…');
  const pool = await AccountPool.load();
  if (pool.size === 0) {
    throw new Error(
      'No active service accounts with a captured session. Run `npm run capture-session` first.',
    );
  }
  console.log(`[orchestrator] account pool: ${pool.size} account(s) — ${pool.status()}`);

  let driver = await launchDriver({ headless: false, storageStateJson: pool.current().storage_state });
  let activeHandle = pool.current().handle;
  console.log(`[orchestrator] Camoufox ready — using @${activeHandle}`);

  const queue = new JobQueue(pool);
  const reclaimed = await queue.reclaimOrphaned();
  if (reclaimed > 0) console.log(`[orchestrator] requeued ${reclaimed} orphaned in-progress job(s)`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[orchestrator] received ${signal}, shutting down…`);
    await driver.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  let jobsSinceProbe = 0;

  while (!stopping) {
    // Rotate accounts when the active one is over its hourly cap or cooling down.
    if (pool.dueForRotation()) {
      const next = pool.pickNext();
      if (!next) {
        const waitMs = Math.min(pool.nextAvailableInMs() + 1_000, 5 * 60 * 1000);
        console.log(`[pool] all accounts at their limit — waiting ${Math.round(waitMs / 1000)}s  [${pool.status()}]`);
        await sleep(waitMs);
        continue;
      }
      if (next.handle !== activeHandle) {
        console.log(`[pool] switching @${activeHandle} → @${next.handle}  [${pool.status()}]`);
        await driver.close().catch(() => {});
        driver = await launchDriver({ headless: false, storageStateJson: next.storage_state });
        activeHandle = next.handle;
      }
    }

    const job = (await queue.claimNext()) ?? (await queue.pickIdleWork());
    if (!job) {
      await sleep(config.pollIntervalMs);
      continue;
    }

    try {
      console.log(
        `[orchestrator] picked job ${job.id} type=${job.job_type} target=${job.target_handle} priority=${job.priority} via @${activeHandle}`,
      );
      // Fail-fast: never let one job hang the worker (a 429 retry loop or a stuck
      // navigation would otherwise block every queued search behind it).
      const budget = job.job_type === 'search_query' ? 150_000 : 75_000;
      await withTimeout(dispatch(job, driver, queue), budget, `${job.job_type} ${job.target_handle}`);
      await queue.complete(job.id, { ok: true });
      void notifyPlatform({
        job_id: job.id,
        job_type: job.job_type,
        target_handle: job.target_handle,
        creator_id: job.creator_id,
        brief_id: job.brief_id,
        success: true,
        error_message: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] job ${job.id} failed:`, msg);
      const retry = job.attempts < 3;
      await queue.fail(job.id, msg, retry);
      if (!retry) {
        void notifyPlatform({
          job_id: job.id,
          job_type: job.job_type,
          target_handle: job.target_handle,
          creator_id: job.creator_id,
          brief_id: job.brief_id,
          success: false,
          error_message: msg,
        });
      }
    }

    // Safety net: probe for a 429 after every job → cool down + rotate off this
    // account. (Discovery also self-reports 429s and penalizes mid-flow, but this
    // catches throttling from any job type promptly so we never keep hammering a
    // tapped-out account.)
    if (++jobsSinceProbe >= 2) {
      jobsSinceProbe = 0;
      if (await probeThrottled(driver.page)) pool.penalizeCurrent();
    }
  }
}

async function dispatch(job: ScrapeJob, driver: DriverHandle, queue: JobQueue): Promise<void> {
  switch (job.job_type) {
    case 'on_demand':
    case 'refresh':
      // Deep per-creator scraping has moved OFF the browser worker. Rich data
      // (followers, recent posts, live ER, reel-forecast inputs) is now fetched
      // on demand by the cookie scraper (platform /api/ig-profile). The browser
      // worker is discovery-only, so we no-op these instead of deep-scraping.
      console.log(`[orchestrator] skipping ${job.job_type} ${job.target_handle} — deep scraping is handled by the cookie scraper now`);
      return;
    case 'discovery_crawl':
      await handleDiscoveryCrawl(job, driver, queue);
      return;
    case 'search_query':
      await handleSearchQuery(job, driver, queue);
      return;
    case 'audience_inference':
      await handleAudienceInference(job, driver, queue);
      return;
    case 'credibility_recompute':
      await handleCredibilityRecompute(job);
      return;
    case 'comment_sample':
      console.log(`[orchestrator] skipping comment_sample (Stage 2+ feature)`);
      return;
    default: {
      const _exhaustive: never = job.job_type;
      throw new Error(`Unknown job type: ${String(_exhaustive)}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Reject if `p` doesn't settle within `ms` — the caller's try/catch then fails
// the job and the loop moves on instead of hanging on a stuck job.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s: ${label}`)), ms)),
  ]);
}
