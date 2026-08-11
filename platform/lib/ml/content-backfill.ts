// ============================================================
// Content-score backfill — the training-data half of the vision layer.
//
// The reach model can learn a "how good was the actual content" effect, but
// only if historical posts carry a vision score. Scoring costs an OpenAI vision
// call per post, so this walks creators' scraped `recent_posts`, scores each
// post's thumbnail once with gpt-4o vision, and caches the 0..1 result in
// post_content_scores. trainReachModels() then joins those scores in.
//
// Deliberately BOUNDED and RESUMABLE: every run scores at most `limit` NEW
// posts and skips anything already scored, so it can be run in small, cheap
// batches until coverage is high enough for the content feature to kick in.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { scoreContent } from '@influencer-intel/shared/content-scorer';
import { normaliseFormat, postKeyOf } from './reach-model';

export interface BackfillReport {
  creators_scanned: number; // creators visited before hitting the limit
  candidates: number;       // unscored posts-with-thumbnail seen this run
  scored: number;           // genuine VISION scores persisted this run
  skipped_no_vision: number; // image couldn't be fetched (e.g. expired IG CDN)
  failed: number;           // scoring/persist errors this run
  reached_limit: boolean;   // stopped because `limit` was hit (more remain)
  total_scored: number;     // total rows in post_content_scores after this run
}

export interface ContentCoverage {
  total_scored: number;   // posts with a cached content score
  creators_scored: number;
}

async function countCoverage(db: ReturnType<typeof getBolticClient>): Promise<ContentCoverage> {
  try {
    const rows = await db.query<{ total: string; creators: string }>(
      `SELECT COUNT(*)::text AS total, COUNT(DISTINCT creator_id)::text AS creators FROM post_content_scores`,
    );
    const r = rows[0];
    return { total_scored: Number(r?.total ?? 0), creators_scored: Number(r?.creators ?? 0) };
  } catch {
    return { total_scored: 0, creators_scored: 0 };
  }
}

/** Read-only coverage snapshot — how many posts already carry a content score. */
export async function contentScoreCoverage(): Promise<ContentCoverage> {
  return countCoverage(getBolticClient());
}

/**
 * Score up to `limit` not-yet-scored posts (default 25, capped 500) and cache
 * ONLY genuine vision scores — if the image can't be fetched (expired/blocked
 * Instagram CDN URL) the model would fall back to caption-only, which the reach
 * model already captures, so we skip it rather than store noise. Best-effort:
 * individual failures are counted, never aborting the batch. Idempotent.
 */
export async function backfillContentScores(opts: { limit?: number } = {}): Promise<BackfillReport> {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 500));
  const db = getBolticClient();

  // Which (creator, post) pairs are already scored — so we never pay twice.
  const existing = new Set<string>();
  try {
    const rows = await db.query<{ creator_id: string; post_key: string }>(
      `SELECT creator_id, post_key FROM post_content_scores`,
    );
    for (const r of rows) existing.add(`${r.creator_id}::${r.post_key}`);
  } catch {
    // Table missing → nothing scored yet; the migration should be applied first.
  }

  const creators = await db.query<{ id: string; recent_posts: unknown }>(
    `SELECT id, recent_posts FROM creators
     WHERE recent_posts IS NOT NULL AND json_array_length(recent_posts) >= 4`,
  ).catch(() => [] as Array<{ id: string; recent_posts: unknown }>);

  let scanned = 0, candidates = 0, scored = 0, skippedNoVision = 0, failed = 0, reachedLimit = false;

  for (const c of creators) {
    if (scored >= limit) { reachedLimit = true; break; }
    const arr = Array.isArray(c.recent_posts) ? (c.recent_posts as Array<Record<string, unknown>>) : [];
    if (arr.length < 4) continue;
    scanned++;

    for (const p of arr) {
      if (scored >= limit) { reachedLimit = true; break; }
      const key = postKeyOf(p);
      const thumb = typeof p.thumbnail_url === 'string' ? p.thumbnail_url.trim() : '';
      if (!key || !thumb) continue; // need a stable key AND an image to score
      const composite = `${c.id}::${key}`;
      if (existing.has(composite)) continue;
      candidates++;

      const fmt = normaliseFormat(typeof p.post_type === 'string' ? p.post_type : null);
      const mediaType = fmt === 'photo' ? 'IMAGE' : fmt === 'carousel' ? 'CAROUSEL_ALBUM' : 'VIDEO';
      try {
        const res = await scoreContent({
          media_url: thumb,
          thumbnail_url: thumb,
          media_type: mediaType,
          caption: typeof p.caption === 'string' ? p.caption : undefined,
        });
        // Only cache a REAL vision score. A caption-only fallback carries no
        // signal the reach model doesn't already have from the caption itself.
        if (!res.vision) { skippedNoVision++; continue; }
        await db.query(
          `INSERT INTO post_content_scores (creator_id, post_key, overall, vision, scored_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (creator_id, post_key) DO UPDATE SET
             overall = EXCLUDED.overall, vision = EXCLUDED.vision, scored_at = now()`,
          [c.id, key, res.scores.overall_weighted, true],
        );
        existing.add(composite);
        scored++;
      } catch (err) {
        failed++;
        console.error('[ml/backfill] score failed:', (err as Error).message);
      }
    }
  }

  const cov = await countCoverage(db);
  return {
    creators_scanned: scanned, candidates, scored, skipped_no_vision: skippedNoVision, failed,
    reached_limit: reachedLimit, total_scored: cov.total_scored,
  };
}
