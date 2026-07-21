// ============================================================
// Orchestrator — main scraper loop.
// ============================================================

import type { Page } from 'playwright-core';
import type { ScrapeJob } from '@influencer-intel/shared/types';
import { getBolticClient } from '@influencer-intel/shared/db';
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
// Probe the active account's health with one cheap authenticated request.
// 'throttled' = 429 (rest + rotate), 'dead' = 401/403 (expired session — park it
// + rotate; resting won't fix it). Run between jobs so the worker self-heals off
// a bad account without anyone asking.
async function probeAccount(page: Page): Promise<'ok' | 'throttled' | 'dead'> {
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
    if (status === 429) return 'throttled';
    if (status === 401 || status === 403) return 'dead';
    return 'ok';
  } catch {
    return 'ok';
  }
}

// Liveness heartbeat: the worker stamps `worker_heartbeat` every ~15s while its
// loop runs. The admin dashboard reads this to show "Worker live" — a TRUE
// signal of the crawl worker being up, instead of the old proxy (max
// last_scraped_at), which also lit up on plain search/discovery writes and so
// masked a dead worker. Best-effort — a heartbeat failure never stops the loop.
let lastBeatAt = 0;
async function beat(): Promise<void> {
  if (Date.now() - lastBeatAt < 15_000) return;
  lastBeatAt = Date.now();
  try {
    await getBolticClient().query(
      `INSERT INTO worker_heartbeat (worker, beat_at) VALUES ('main', now())
       ON CONFLICT (worker) DO UPDATE SET beat_at = now()`,
    );
  } catch {
    /* heartbeat is best-effort — never break the crawl loop */
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
  let jobsSinceRotate = 0;
  let lastPoolRefresh = Date.now();

  // Move the active account to `next`, relaunching the browser with its session.
  // No-op if it's already active. Shared by proactive + forced rotation.
  const rotateTo = async (next: { handle: string; storage_state: unknown } | null, reason: string) => {
    if (!next || next.handle === activeHandle) return;
    console.log(`[pool] ${reason} @${activeHandle} → @${next.handle}  [${pool.status()}]`);
    await driver.close().catch(() => {});
    driver = await launchDriver({ headless: false, storageStateJson: next.storage_state });
    activeHandle = next.handle;
  };

  while (!stopping) {
    await beat(); // stamp worker liveness (throttled to ~15s)
    // Periodically re-sync the pool from the DB so accounts you capture/revive
    // join rotation on their own, and removed/expired ones drop — no manual
    // worker restart needed.
    if (Date.now() - lastPoolRefresh > config.poolRefreshMs) {
      lastPoolRefresh = Date.now();
      try {
        const { added, removed } = await pool.refresh();
        if (added.length || removed.length) {
          console.log(`[pool] refreshed — +[${added.join(', ') || '—'}] -[${removed.join(', ') || '—'}]  [${pool.status()}]`);
        }
        // If the account we're currently launched with vanished, move the
        // browser onto whatever the pool now treats as current.
        if (pool.size > 0) await rotateTo(pool.current(), 'pool refresh');
      } catch (err) {
        console.warn('[pool] refresh failed:', err instanceof Error ? err.message : String(err));
      }
    }
    if (pool.size === 0) {
      console.warn('[pool] no accounts available — waiting for one to be captured/revived…');
      await sleep(Math.min(config.poolRefreshMs, 60_000));
      continue;
    }

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
      // Record which account is crawling right now, so the admin Scraper page
      // can show a live "active now" badge on it.
      pool.markActive();
      // Fail-fast: never let one job hang the worker (a 429 retry loop or a stuck
      // navigation would otherwise block every queued search behind it).
      const budget = job.job_type === 'search_query' ? 230_000 : 75_000;
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

    // Self-heal: probe the active account after every couple of jobs. 429 →
    // cool it down; 401/403 (dead/expired session) → PARK it. Either way the
    // next loop rotates to a healthy account automatically — no manual swapping.
    if (++jobsSinceProbe >= 2) {
      jobsSinceProbe = 0;
      const health = await probeAccount(driver.page);
      if (health === 'throttled') pool.penalizeCurrent();
      else if (health === 'dead') pool.markCurrentDead();
      else pool.reportAlive(); // healthy probe → clear any stray dead-strike streak
    }

    // Proactive rotation: after each job, hand off to the least-used ready
    // account — WELL before the active one bursts enough to get flagged. This
    // is "swap before it dies": spread the crawl load thin across the pool so
    // no single account builds a footprint IG wants to kill. Crawl jobs run for
    // minutes, so the few-second browser relaunch between them is negligible.
    if (++jobsSinceRotate >= config.rotateEveryJobs) {
      jobsSinceRotate = 0;
      await rotateTo(pool.pickNext(), 'proactive rotate');
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
