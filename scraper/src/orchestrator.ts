// ============================================================
// Orchestrator — main scraper loop.
// ============================================================

import type { Page } from 'playwright-core';
import type { ScrapeJob } from '@influencer-intel/shared/types';
import { config, assertConfig } from './config.js';
import { JobQueue } from './queue/worker.js';
import { AccountPool } from './queue/account-pool.js';
import { launchDriver, type DriverHandle } from './playwright-driver.js';
import { handleProfileScrape } from './jobs/profile-scraper.js';
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
      await dispatch(job, driver, queue);
      await queue.complete(job.id, { ok: true });
      await notifyPlatform({
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
        await notifyPlatform({
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

    // Every few jobs, probe for a 429 → cool down + rotate off this account.
    if (++jobsSinceProbe >= 6) {
      jobsSinceProbe = 0;
      if (await probeThrottled(driver.page)) pool.penalizeCurrent();
    }
  }
}

async function dispatch(job: ScrapeJob, driver: DriverHandle, queue: JobQueue): Promise<void> {
  switch (job.job_type) {
    case 'on_demand':
    case 'refresh':
      await handleProfileScrape(job, driver, queue);
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
