// ============================================================
// Trend ingestion — fills `trend_signals` from our OWN crawl data.
//
// Every creator row carries `recent_posts` (JSONB RecentPost[]) with a caption,
// posted_at and post_type. This walks those posts over a rolling window and
// derives which HASHTAGS and content FORMATS are gaining or losing momentum,
// then upserts them into trend_signals so /api/trends, the prediction engine
// and the brand campaign-ideas feature all read real, first-party trends.
//
// Deliberately first-party only: audio trends aren't in recent_posts (they need
// an external source like Apify), so this covers hashtag + format. Idempotent —
// upserts on (trend_type, identifier); first_seen_at is preserved across runs.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { RecentPost } from '@influencer-intel/shared/types';

export interface TrendIngestReport {
  creators_scanned: number;   // creators whose posts we read this run
  posts_scanned: number;      // posts inside the 2×window range
  hashtags_tracked: number;   // distinct hashtags that cleared the threshold
  formats_tracked: number;    // distinct post formats
  visual_tracked: number;     // distinct visual motifs (only when withVisual)
  posts_visually_tagged: number; // post images sent to the vision model this run
  signals_upserted: number;   // rows written to trend_signals
  window_days: number;        // the current-vs-prior comparison window
}

// Split an array into fixed-size chunks (batching DB param lists + vision calls).
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// "pastel palette" -> "Pastel Palette" for a readable trend display_name.
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface CreatorRow {
  id: string;
  primary_category: string | null;
  genre: string | null;
  niche: string | null;
  recent_posts: RecentPost[] | null;
}

// Rolling accumulator for one trend identifier across all creators/posts.
interface Bucket {
  display_name: string;
  count_current: number; // posts in the current window (0..windowDays)
  count_prior: number;   // posts in the prior window (windowDays..2×windowDays)
  count_24h: number;     // posts in the last 24h (subset of current)
  categories: Set<string>;
}

const HASHTAG_RE = /#([\p{L}0-9_]{2,60})/gu;
const MS_PER_DAY = 86_400_000;

// Map an Instagram post_type to a small, stable set of format identifiers so
// "Reel", "CLIPS", "video" etc. don't fragment into separate trends.
function normaliseFormat(postType: string | null): { id: string; label: string } | null {
  const t = (postType ?? '').toLowerCase();
  if (!t) return null;
  if (/reel|clip|video|igtv/.test(t)) return { id: 'reel', label: 'Reels' };
  if (/carousel|sidecar|album/.test(t)) return { id: 'carousel', label: 'Carousels' };
  if (/image|photo|feed|graph_?image/.test(t)) return { id: 'image', label: 'Single image' };
  if (/story|stories/.test(t)) return { id: 'story', label: 'Stories' };
  return null;
}

function classifyPhase(current: number, prior: number, velocity: number): string {
  if (prior === 0) return 'emerging';         // brand-new this window
  if (velocity >= 0.5) return 'growing';       // ≥50% more usage than last window
  if (velocity <= -0.5) return 'declining';    // usage more than halved
  if (velocity < 0) return 'saturated';        // gently fading
  return 'peak';                               // high, roughly flat
}

/**
 * Scan up to `creatorLimit` creators' recent posts and (re)compute hashtag +
 * format trend signals over a rolling `windowDays` window. Best-effort: bad rows
 * are skipped, never aborting the run. Only identifiers with enough volume in
 * either window are written, so we don't flood the table with one-off tags.
 */
export async function ingestTrendSignals(
  opts: {
    creatorLimit?: number;
    windowDays?: number;
    minCount?: number;
    // Also derive VISUAL/aesthetic trends by vision-tagging post thumbnails.
    // Off by default — it makes (budgeted) OpenAI vision calls.
    withVisual?: boolean;
    // Max NEW post images to send to the vision model this run (cached posts are
    // free). Bounds cost/latency; coverage grows across runs as the cache fills.
    visualBudget?: number;
  } = {},
): Promise<TrendIngestReport> {
  const creatorLimit = Math.max(1, Math.min(opts.creatorLimit ?? 5000, 50_000));
  // Default to a 7-day rolling window for live daily crawling, but allow up to
  // 180 so trend math still works on batch/historical corpora where posts are
  // spread over months rather than a fresh daily feed.
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 7, 180));
  const minCount = Math.max(2, opts.minCount ?? 3);
  const withVisual = opts.withVisual === true;
  const visualBudget = Math.max(0, Math.min(opts.visualBudget ?? 120, 500));
  const db = getBolticClient();

  const now = Date.now();
  const currentCutoff = now - windowDays * MS_PER_DAY;
  const priorCutoff = now - 2 * windowDays * MS_PER_DAY;
  const dayCutoff = now - MS_PER_DAY;

  const creators = await db.query<CreatorRow>(
    `SELECT id, primary_category, genre, niche, recent_posts
       FROM creators
      WHERE recent_posts IS NOT NULL
        AND jsonb_typeof(recent_posts::jsonb) = 'array'
        AND jsonb_array_length(recent_posts::jsonb) > 0
      ORDER BY updated_at DESC NULLS LAST
      LIMIT ${creatorLimit}`,
  );

  const hashtags = new Map<string, Bucket>();
  const formats = new Map<string, Bucket>();
  // Posts (with a thumbnail, in the 2×window range) that are candidates for
  // visual tagging. Deduped by post id; keeps the timing + categories so the
  // motif aggregation uses the same current-vs-prior windowing as hashtags.
  const visualPosts = new Map<string, { imageUrl: string; when: number; cats: string[] }>();
  let postsScanned = 0;

  const bump = (
    map: Map<string, Bucket>,
    id: string,
    label: string,
    when: number,
    cats: string[],
  ) => {
    let b = map.get(id);
    if (!b) {
      b = { display_name: label, count_current: 0, count_prior: 0, count_24h: 0, categories: new Set() };
      map.set(id, b);
    }
    if (when >= currentCutoff) {
      b.count_current += 1;
      if (when >= dayCutoff) b.count_24h += 1;
    } else {
      b.count_prior += 1;
    }
    for (const c of cats) if (c) b.categories.add(c);
  };

  for (const cr of creators) {
    const posts = Array.isArray(cr.recent_posts) ? cr.recent_posts : [];
    if (posts.length === 0) continue;
    const cats = [cr.primary_category, cr.genre, cr.niche]
      .filter((c): c is string => !!c && c.trim().length > 0)
      .map((c) => c.trim().toLowerCase());

    for (const p of posts) {
      const ts = p.posted_at ? Date.parse(p.posted_at) : NaN;
      if (!Number.isFinite(ts) || ts < priorCutoff || ts > now) continue;
      postsScanned += 1;

      // Hashtags from the caption.
      if (p.caption) {
        const seen = new Set<string>();
        for (const m of p.caption.matchAll(HASHTAG_RE)) {
          const tag = (m[1] ?? '').toLowerCase();
          if (!tag || seen.has(tag)) continue; // count a tag once per post
          seen.add(tag);
          bump(hashtags, tag, `#${m[1]}`, ts, cats);
        }
      }

      // Content format from post_type.
      const fmt = normaliseFormat(p.post_type);
      if (fmt) bump(formats, fmt.id, fmt.label, ts, cats);

      // Queue the post image for visual-motif tagging (deduped by post id).
      if (withVisual && p.thumbnail_url && p.platform_post_id && !visualPosts.has(p.platform_post_id)) {
        visualPosts.set(p.platform_post_id, { imageUrl: p.thumbnail_url, when: ts, cats });
      }
    }
  }

  // Upsert the identifiers that cleared the volume threshold in either window.
  const upsert = async (
    trendType: 'hashtag' | 'format' | 'visual',
    map: Map<string, Bucket>,
    limits: { minCount: number; cap: number },
  ): Promise<number> => {
    let written = 0;
    // Rank by current usage so we cap the write volume to the liveliest trends.
    const ranked = [...map.entries()]
      .filter(([, b]) => b.count_current >= limits.minCount || b.count_prior >= limits.minCount)
      .sort((a, b) => b[1].count_current - a[1].count_current)
      .slice(0, limits.cap);

    for (const [id, b] of ranked) {
      const velocity = (b.count_current - b.count_prior) / Math.max(b.count_prior, 1);
      const clamped = Math.max(-9999, Math.min(9999, Number(velocity.toFixed(4))));
      const phase = classifyPhase(b.count_current, b.count_prior, velocity);
      const categories = [...b.categories].slice(0, 12);
      try {
        await db.query(
          `INSERT INTO trend_signals
             (trend_type, identifier, display_name, phase, velocity,
              usage_count_24h, usage_count_7d, categories, peak_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (trend_type, identifier) DO UPDATE SET
             display_name    = EXCLUDED.display_name,
             phase           = EXCLUDED.phase,
             velocity        = EXCLUDED.velocity,
             usage_count_24h = EXCLUDED.usage_count_24h,
             usage_count_7d  = EXCLUDED.usage_count_7d,
             categories      = EXCLUDED.categories,
             peak_at         = COALESCE(trend_signals.peak_at, EXCLUDED.peak_at),
             updated_at      = NOW()`,
          [
            trendType,
            id,
            b.display_name,
            phase,
            clamped,
            b.count_24h,
            b.count_current,
            categories,
            phase === 'peak' ? new Date().toISOString() : null,
          ],
        );
        written += 1;
      } catch (err) {
        console.error(`[trend-ingest] upsert failed for ${trendType}:${id}`, err);
      }
    }
    return written;
  };

  const hashtagsWritten = await upsert('hashtag', hashtags, { minCount, cap: 300 });
  const formatsWritten = await upsert('format', formats, { minCount, cap: 20 });

  // ── Visual / aesthetic motifs ────────────────────────────────────────────
  // Vision-tag post thumbnails (budgeted + cached), then aggregate the motifs
  // exactly like hashtags so image-only trends surface with velocity + phase.
  const visuals = new Map<string, Bucket>();
  let postsVisuallyTagged = 0;
  let visualsWritten = 0;
  if (withVisual && visualPosts.size > 0) {
    const ids = [...visualPosts.keys()];
    const cachedTags = new Map<string, string[]>();

    // 1. Load already-tagged posts from the cache (chunked to bound param count).
    for (const idChunk of chunk(ids, 500)) {
      try {
        const rows = await db.query<{ platform_post_id: string; tags: string[] }>(
          `SELECT platform_post_id, tags FROM post_visual_tags
            WHERE platform_post_id = ANY($1::text[])`,
          [idChunk],
        );
        for (const r of rows) cachedTags.set(r.platform_post_id, Array.isArray(r.tags) ? r.tags : []);
      } catch (err) {
        console.error('[trend-ingest] visual cache read failed', err);
      }
    }

    // 2. Tag NEW posts up to the budget — newest first, so fresh trends get
    //    covered before we spend on backfill. Cache every result (empty too).
    const untagged = ids.filter((id) => !cachedTags.has(id));
    untagged.sort((a, b) => visualPosts.get(b)!.when - visualPosts.get(a)!.when);
    const toTag = untagged.slice(0, visualBudget);
    const openai = getOpenAIClient();
    for (const batch of chunk(toTag, 8)) {
      const items = batch.map((id) => ({ postId: id, imageUrl: visualPosts.get(id)!.imageUrl }));
      let res: Record<string, string[]> = {};
      try {
        res = await openai.extractVisualMotifs(items);
      } catch (err) {
        console.error('[trend-ingest] visual tagging failed', err);
      }
      for (const id of batch) {
        const tags = res[id] ?? [];
        cachedTags.set(id, tags);
        postsVisuallyTagged += 1;
        try {
          await db.query(
            `INSERT INTO post_visual_tags (platform_post_id, tags, tagged_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (platform_post_id) DO UPDATE SET tags = EXCLUDED.tags, tagged_at = NOW()`,
            [id, tags],
          );
        } catch (err) {
          console.error(`[trend-ingest] visual cache write failed for ${id}`, err);
        }
      }
    }

    // 3. Aggregate every candidate that has tags (cached or newly tagged).
    for (const id of ids) {
      const tags = cachedTags.get(id);
      if (!tags || tags.length === 0) continue;
      const p = visualPosts.get(id)!;
      for (const tag of tags) bump(visuals, tag, titleCase(tag), p.when, p.cats);
    }

    // Visual coverage is budget-limited, so counts run lower than hashtags —
    // use a gentler threshold and a modest cap.
    visualsWritten = await upsert('visual', visuals, { minCount: 2, cap: 60 });
  }

  return {
    creators_scanned: creators.length,
    posts_scanned: postsScanned,
    hashtags_tracked: hashtagsWritten,
    formats_tracked: formatsWritten,
    visual_tracked: visualsWritten,
    posts_visually_tagged: postsVisuallyTagged,
    signals_upserted: hashtagsWritten + formatsWritten + visualsWritten,
    window_days: windowDays,
  };
}
