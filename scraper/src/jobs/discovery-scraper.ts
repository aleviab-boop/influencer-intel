// ============================================================
// Discovery crawl — visits IG hashtag pages and collects the
// handles of recent posters. Each handle becomes a candidate for
// future enrichment. This is the lightweight "directory" build
// that runs during idle time.
// ============================================================

import type { ScrapeJob } from '@influencer-intel/shared/types';
import { getBolticClient } from '@influencer-intel/shared/db';
import {
  humanDelay,
  navigateHumanly,
  type DriverHandle,
} from '../playwright-driver.js';
import type { JobQueue } from '../queue/worker.js';

export async function handleDiscoveryCrawl(
  job: ScrapeJob,
  driver: DriverHandle,
  queue: JobQueue,
): Promise<void> {
  const tag = job.target_handle.toLowerCase().replace(/^#/, '');
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
  console.log(`[discovery] crawling #${tag}`);

  const ok = await navigateHumanly(driver.page, url);
  if (!ok) throw new Error(`Failed to load hashtag page #${tag}`);
  queue.bumpActions(1);

  // Wait for the post grid to render
  try {
    await driver.page.waitForSelector('article a[href*="/p/"], article a[href*="/reel/"]', {
      timeout: 8_000,
    });
  } catch {
    console.warn(`[discovery] no posts visible for #${tag}`);
    return;
  }

  // Extract handles from the visible post links by hovering for tooltips
  // Simpler: grab post links, then visit each post's permalink in batch is too aggressive.
  // Instead: read the og:image alt text or aria-label which often contains the @username.
  const handles = await driver.page.evaluate(() => {
    const set = new Set<string>();
    document.querySelectorAll('article a[href*="/p/"], article a[href*="/reel/"]').forEach((a) => {
      const ariaLabel = a.getAttribute('aria-label') ?? '';
      const m = ariaLabel.match(/by\s+([a-z0-9._]+)/i);
      if (m) set.add(m[1]!.toLowerCase());
    });
    return Array.from(set);
  });

  console.log(`[discovery] found ${handles.length} unique handles for #${tag}`);

  // Persist each handle as a stub creator row (only if not already present)
  const db = getBolticClient();
  for (const handle of handles) {
    await db.query(
      `INSERT INTO creators (platform, handle, profile_url, data_tier, first_indexed_at)
       VALUES ('instagram', $1, $2, 'tier_c', NOW())
       ON CONFLICT (platform, handle) DO NOTHING`,
      [handle, `https://www.instagram.com/${handle}/`],
    );
  }

  await humanDelay();
}
