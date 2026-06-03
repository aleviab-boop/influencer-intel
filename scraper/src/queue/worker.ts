// ============================================================
// Dual-queue worker — pulls highest-priority job from Boltic
// Tables and dispatches to the appropriate handler. Priority
// queue (on_demand) preempts background queue.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { ScrapeJob } from '@influencer-intel/shared/types';
import { config } from '../config.js';

export class JobQueue {
  private readonly db = getBolticClient();
  private actionsThisHour = 0;
  private hourReset = Date.now() + 3_600_000;

  /** Claim the next available job (priority order). Marks it in_progress. */
  async claimNext(): Promise<ScrapeJob | null> {
    this.maybeResetActions();
    if (this.actionsThisHour >= config.maxActionsPerHour) {
      // Rate-limit hit: wait out the hour
      return null;
    }

    const rows = await this.db.query<ScrapeJob>(
      `UPDATE scrape_jobs
       SET status = 'in_progress', started_at = NOW(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM scrape_jobs
         WHERE status = 'queued' AND attempts < 3
         ORDER BY priority ASC, queued_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
    );
    return rows[0] ?? null;
  }

  /** Mark a job as completed with optional summary. */
  async complete(jobId: string, summary?: unknown): Promise<void> {
    await this.db.update(
      'scrape_jobs',
      { id: jobId },
      {
        status: 'completed',
        completed_at: new Date().toISOString(),
        result_summary: summary ?? null,
      },
    );
  }

  /** Mark a job as failed (or queued back if retries remain). */
  async fail(jobId: string, error: string, retry = true): Promise<void> {
    await this.db.update(
      'scrape_jobs',
      { id: jobId },
      retry
        ? { status: 'queued', error_message: error }
        : {
            status: 'failed',
            error_message: error,
            completed_at: new Date().toISOString(),
          },
    );
  }

  /** Enqueue a background job (used by idle-time fillers). */
  async enqueueBackground(args: {
    job_type: ScrapeJob['job_type'];
    target_handle: string;
    target_platform?: ScrapeJob['target_platform'];
    creator_id?: string | null;
    brief_id?: string | null;
    priority?: number;
  }): Promise<void> {
    await this.db.insert('scrape_jobs', {
      job_type: args.job_type,
      target_platform: args.target_platform ?? 'instagram',
      target_handle: args.target_handle,
      creator_id: args.creator_id ?? null,
      brief_id: args.brief_id ?? null,
      priority: args.priority ?? 5,
      status: 'queued',
      attempts: 0,
      queued_at: new Date().toISOString(),
    });
  }

  /** Pick a background job to keep the scraper busy when idle. */
  async pickIdleWork(): Promise<ScrapeJob | null> {
    // Prefer: stale creators that have been searched recently
    const rows = await this.db.query<{ id: string; handle: string; platform: string }>(
      `SELECT id, handle, platform FROM creators
       WHERE last_scraped_at < NOW() - INTERVAL '14 days'
       ORDER BY last_scraped_at ASC NULLS FIRST
       LIMIT 1`,
    );
    const stale = rows[0];
    if (!stale) return null;

    await this.enqueueBackground({
      job_type: 'refresh',
      target_handle: stale.handle,
      target_platform: stale.platform as ScrapeJob['target_platform'],
      creator_id: stale.id,
      priority: 8,
    });
    return this.claimNext();
  }

  bumpActions(n = 1): void {
    this.maybeResetActions();
    this.actionsThisHour += n;
  }

  private maybeResetActions(): void {
    if (Date.now() > this.hourReset) {
      this.actionsThisHour = 0;
      this.hourReset = Date.now() + 3_600_000;
    }
  }
}
