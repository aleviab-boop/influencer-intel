// ============================================================
// Notifies the platform that a scrape job has completed.
// Platform listens at /api/scrape-callback and re-ranks any
// shortlists waiting on this creator.
// ============================================================

import crypto from 'node:crypto';
import type { ScrapeCompletionEvent } from '@influencer-intel/shared/types';
import { config } from './config.js';

export async function notifyPlatform(event: ScrapeCompletionEvent): Promise<void> {
  if (!config.platformCallbackUrl) {
    console.warn('[notify] PLATFORM_CALLBACK_URL not set, skipping');
    return;
  }
  const body = JSON.stringify(event);
  const signature = config.callbackSecret
    ? crypto.createHmac('sha256', config.callbackSecret).update(body).digest('hex')
    : '';

  // Retry on 5xx + network errors with exponential backoff. We've been
  // burned by silent failures (e.g. webpack cache 500'd every callback for
  // 30 minutes; shortlists got stuck because no rerank fired). Three
  // attempts with 2s/6s waits costs ≤8s total and recovers from blips.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(config.platformCallbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
        },
        body,
      });
      if (res.ok) return;
      const isRetryable = res.status >= 500 || res.status === 408 || res.status === 429;
      const text = await res.text().catch(() => '');
      const snippet = text.length > 200 ? `${text.slice(0, 180)}…` : text;
      if (!isRetryable || attempt === maxAttempts) {
        console.warn(`[notify] platform responded ${res.status} (attempt ${attempt}/${maxAttempts}): ${snippet}`);
        return;
      }
      console.warn(`[notify] retryable ${res.status} attempt ${attempt}/${maxAttempts}, retrying…`);
    } catch (err) {
      if (attempt === maxAttempts) {
        console.warn(`[notify] platform unreachable after ${maxAttempts} attempts:`, err);
        return;
      }
      console.warn(`[notify] network error attempt ${attempt}/${maxAttempts}, retrying…`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2_000));
  }
}
