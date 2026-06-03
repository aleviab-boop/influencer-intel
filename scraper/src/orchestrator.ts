// ============================================================
// Orchestrator — main scraper loop.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { ScrapeJob, ServiceAccount } from '@influencer-intel/shared/types';
import { config, assertConfig } from './config.js';
import { JobQueue } from './queue/worker.js';
import { launchDriver, type DriverHandle } from './playwright-driver.js';
import { handleProfileScrape } from './jobs/profile-scraper.js';
import { handleDiscoveryCrawl } from './jobs/discovery-scraper.js';
import { handleAudienceInference } from './jobs/audience-inference.js';
import { handleCredibilityRecompute } from './jobs/credibility-scorer.js';
import { handleSearchQuery } from './jobs/search-discovery.js';
import { notifyPlatform } from './platform-notify.js';

async function loadServiceAccount(): Promise<ServiceAccount> {
  const db = getBolticClient();
  const rows = await db.query<ServiceAccount>(
    `SELECT * FROM service_accounts
     WHERE platform = 'instagram' AND handle = $1 AND status = 'active'
     ORDER BY storage_captured_at DESC NULLS LAST
     LIMIT 1`,
    [config.serviceAccountHandle],
  );
  if (rows.length === 0) {
    throw new Error(
      `No active service account found for handle "${config.serviceAccountHandle}". Run \`npm run capture-session\` first.`,
    );
  }
  return rows[0]!;
}

export async function run(): Promise<void> {
  assertConfig();

  console.log('[orchestrator] starting…');
  const serviceAccount = await loadServiceAccount();
  console.log(`[orchestrator] using service account @${serviceAccount.handle}`);

  const driver = await launchDriver({
    headless: false,
    storageStateJson: serviceAccount.storage_state,
  });
  console.log('[orchestrator] Camoufox Firefox ready');

  const queue = new JobQueue();

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

  while (!stopping) {
    const job = (await queue.claimNext()) ?? (await queue.pickIdleWork());
    if (!job) {
      await sleep(config.pollIntervalMs);
      continue;
    }

    try {
      console.log(
        `[orchestrator] picked job ${job.id} type=${job.job_type} target=${job.target_handle} priority=${job.priority}`,
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
