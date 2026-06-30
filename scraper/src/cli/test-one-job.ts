// ============================================================
// CLI: test-one-job
// Controlled single-job worker test. Enqueues ONE on_demand profile
// scrape for the given handle, launches the browser with the seeded
// session, runs exactly that job, persists, then exits. Unlike the
// orchestrator it does NOT loop or pull idle/refresh work — so the
// first live run against Instagram is a single, observable scrape.
//
// Usage: npx tsx scraper/src/cli/test-one-job.ts <handle> [--headless]
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { ScrapeJob, ServiceAccount } from '@influencer-intel/shared/types';
import { config, assertConfig } from '../config.js';
import { JobQueue } from '../queue/worker.js';
import { launchDriver } from '../playwright-driver.js';
import { handleProfileScrape } from '../jobs/profile-scraper.js';

async function main(): Promise<void> {
  const handle = (process.argv[2] ?? '').trim().toLowerCase().replace(/^@/, '');
  const headless = process.argv.includes('--headless');
  if (!handle) throw new Error('Usage: test-one-job <handle> [--headless]');

  assertConfig();

  const db = getBolticClient();
  const accounts = await db.query<ServiceAccount>(
    `SELECT * FROM service_accounts
     WHERE platform = 'instagram' AND handle = $1 AND status = 'active'
     ORDER BY storage_captured_at DESC NULLS LAST LIMIT 1`,
    [config.serviceAccountHandle],
  );
  const account = accounts[0];
  if (!account) throw new Error(`No active service account "${config.serviceAccountHandle}"`);
  console.log(`[test-one-job] service account @${account.handle}, target @${handle}`);

  // Enqueue exactly one on_demand job (priority 1 = top).
  const queue = new JobQueue();
  await queue.enqueueBackground({ job_type: 'on_demand', target_handle: handle, priority: 1 });
  const job = await queue.claimNext();
  if (!job) throw new Error('Could not claim the enqueued job');
  console.log(`[test-one-job] claimed job ${job.id} type=${job.job_type}`);

  const driver = await launchDriver({ headless, storageStateJson: account.storage_state });
  console.log(`[test-one-job] browser ready (headless=${headless}); scraping…`);

  try {
    await handleProfileScrape(job as ScrapeJob, driver, queue);
    await queue.complete(job.id, { ok: true, test: true });
    console.log(`[test-one-job] DONE job ${job.id} completed`);
    // Show what persisted.
    const rows = await db.query<{ handle: string; follower_count: number | null; posts_count: number | null; last_scraped_at: string | null; engagement_rate: number | null; primary_category: string | null }>(
      `SELECT handle, follower_count, posts_count, last_scraped_at, engagement_rate, primary_category
         FROM creators WHERE platform = 'instagram' AND lower(handle) = $1 LIMIT 1`,
      [handle],
    );
    console.log('[test-one-job] persisted=' + JSON.stringify(rows[0] ?? null));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await queue.fail(job.id, msg, false);
    console.error(`[test-one-job] job ${job.id} FAILED:`, msg);
  } finally {
    await driver.close().catch(() => {});
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[test-one-job] fatal:', (err as Error).message);
  process.exit(1);
});
