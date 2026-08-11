// ============================================================
// Reach model — the trained layer of the views/likes predictor.
//
// What it learns: from every creator's REAL post history, how a post's raw
// likes/views deviate from that creator's OWN baseline, as a function of the
// content itself — format (reel/photo/carousel), caption length, hashtag count,
// emoji use, and call-to-action language.
//
// Why residuals: creators differ in scale by 1000×. Instead of asking the model
// to relearn each creator's size, we train it on the log-ratio of a post's
// outcome to that creator's leave-one-out median. The model then only has to
// learn the *content* effect, which is small-variance and shared across
// creators — so it generalises from a modest dataset.
//
// What it does NOT learn: "is this trending right now" and "is this the
// creator's best time slot" — those can't be reconstructed from old posts
// (we don't know what was trending months ago). Those stay as live signals
// applied on top by reach-predictor.ts. This split is what makes the combined
// prediction both trained AND honest.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { trainRidge, predict, type RidgeModel } from './ridge';

// ── feature engineering (shared by training and inference) ──────────────────

export type ReachFormat = 'reel' | 'photo' | 'carousel';

export interface ContentFeatures {
  format: ReachFormat;
  caption: string;
  hashtagCount: number; // explicit tag count; caption tags are also counted
}

const VIDEO_TYPES = new Set(['reels', 'reel', 'video', 'clips']);

// Normalise a raw post_type / media_type string to one of our three formats.
export function normaliseFormat(postType: string | null | undefined): ReachFormat {
  const s = (postType ?? '').toLowerCase();
  if (VIDEO_TYPES.has(s) || s === 'reels' || s === 'video') return 'reel';
  if (s.includes('carousel') || s.includes('album') || s.includes('sidecar')) return 'carousel';
  return 'photo';
}

const CTA_RX = /\b(link in bio|comment below|comment|tag a|tag your|save this|share this|swipe|dm me|drop a|giveaway|link below)\b/i;
const EMOJI_RX = /\p{Extended_Pictographic}/u;

function countHashtags(caption: string): number {
  const m = caption.match(/#\w+/g);
  return m ? m.length : 0;
}

// The likes model sees the full format space (reel / photo / carousel).
export const LIKES_FEATURES = [
  'is_video', 'is_carousel', 'log_caption_len', 'hashtag_count', 'has_emoji', 'has_cta',
] as const;
// The views model only sees videos, so format flags are constant and dropped.
export const VIEWS_FEATURES = [
  'log_caption_len', 'hashtag_count', 'has_emoji', 'has_cta',
] as const;

function baseSignals(f: ContentFeatures) {
  const caption = f.caption ?? '';
  const tags = Math.min(30, Math.max(f.hashtagCount, countHashtags(caption)));
  return {
    logCaptionLen: Math.log1p(caption.trim().length),
    hashtags: tags,
    hasEmoji: EMOJI_RX.test(caption) ? 1 : 0,
    hasCta: CTA_RX.test(caption) ? 1 : 0,
  };
}

export function likesFeatureRow(f: ContentFeatures): number[] {
  const s = baseSignals(f);
  return [
    f.format === 'reel' ? 1 : 0,
    f.format === 'carousel' ? 1 : 0,
    s.logCaptionLen, s.hashtags, s.hasEmoji, s.hasCta,
  ];
}

export function viewsFeatureRow(f: ContentFeatures): number[] {
  const s = baseSignals(f);
  return [s.logCaptionLen, s.hashtags, s.hasEmoji, s.hasCta];
}

// ── training-data extraction ────────────────────────────────────────────────

type RawPost = {
  post_type: string | null;
  caption: string | null;
  like_count: number | null;
  view_count: number | null;
};

// Median of an array EXCLUDING one index — the leave-one-out baseline, so a
// post is never compared against itself (which would leak the label).
function looMedian(values: number[], excludeIdx: number): number | null {
  const rest = values.filter((_, i) => i !== excludeIdx && values[i]! > 0);
  if (rest.length === 0) return null;
  const s = [...rest].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

interface Dataset { X: number[][]; y: number[] }

// Turn one creator's posts into (features → log-residual) training rows.
function addCreatorRows(posts: RawPost[], likesDS: Dataset, viewsDS: Dataset): void {
  if (posts.length < 4) return; // too few to form a stable leave-one-out baseline
  const likes = posts.map((p) => Number(p.like_count) || 0);
  const views = posts.map((p) => Number(p.view_count) || 0);

  posts.forEach((p, i) => {
    const fmt = normaliseFormat(p.post_type);
    const feat: ContentFeatures = { format: fmt, caption: p.caption ?? '', hashtagCount: 0 };

    const like = likes[i]!;
    if (like > 0) {
      const base = looMedian(likes, i);
      if (base && base > 0) {
        likesDS.X.push(likesFeatureRow(feat));
        likesDS.y.push(Math.log(like) - Math.log(base)); // log-residual target
      }
    }
    // Views only exist for video; train the views model on those alone.
    if (fmt === 'reel') {
      const view = views[i]!;
      if (view > 0) {
        const vbase = looMedian(views.map((v, j) => (normaliseFormat(posts[j]!.post_type) === 'reel' ? v : 0)), i);
        if (vbase && vbase > 0) {
          viewsDS.X.push(viewsFeatureRow(feat));
          viewsDS.y.push(Math.log(view) - Math.log(vbase));
        }
      }
    }
  });
}

export interface TrainReport {
  likes: { trained: boolean; rmse: number; r2: number; n_samples: number };
  views: { trained: boolean; rmse: number; r2: number; n_samples: number };
  creators_scanned: number;
  trained_at: string;
}

/**
 * Pull every creator's historical posts (scraped `recent_posts` + OAuth
 * `post_insights`), build the residual dataset, fit the likes & views ridge
 * models, and persist them. Returns holdout metrics.
 */
export async function trainReachModels(): Promise<TrainReport> {
  const db = getBolticClient();
  const likesDS: Dataset = { X: [], y: [] };
  const viewsDS: Dataset = { X: [], y: [] };
  let creatorsScanned = 0;

  // 1) Scraped history: recent_posts JSONB on creators.
  // recent_posts is a `json` column (not jsonb) → use json_array_length.
  const creatorRows = await db.query<{ id: string; recent_posts: unknown }>(
    `SELECT id, recent_posts FROM creators
     WHERE recent_posts IS NOT NULL AND json_array_length(recent_posts) >= 4`,
  ).catch(() => [] as Array<{ id: string; recent_posts: unknown }>);

  for (const row of creatorRows) {
    const arr = Array.isArray(row.recent_posts) ? row.recent_posts as Array<Record<string, unknown>> : [];
    if (arr.length < 4) continue;
    creatorsScanned++;
    const posts: RawPost[] = arr.map((p) => ({
      post_type: (p.post_type as string) ?? null,
      caption: (p.caption as string) ?? null,
      like_count: p.like_count != null ? Number(p.like_count) : null,
      view_count: p.view_count != null ? Number(p.view_count) : null,
    }));
    addCreatorRows(posts, likesDS, viewsDS);
  }

  // 2) OAuth history: post_insights grouped by creator.
  const insightRows = await db.query<{
    creator_id: string; media_type: string | null; caption: string | null;
    like_count: number | string | null; plays: number | string | null;
  }>(
    `SELECT creator_id, media_type, caption, like_count, plays
     FROM post_insights ORDER BY creator_id`,
  ).catch(() => [] as Array<{ creator_id: string; media_type: string | null; caption: string | null; like_count: number | string | null; plays: number | string | null }>);

  const byCreator = new Map<string, RawPost[]>();
  for (const r of insightRows) {
    const list = byCreator.get(r.creator_id) ?? [];
    list.push({
      post_type: r.media_type,
      caption: r.caption,
      like_count: r.like_count != null ? Number(r.like_count) : null,
      view_count: r.plays != null ? Number(r.plays) : null,
    });
    byCreator.set(r.creator_id, list);
  }
  for (const posts of byCreator.values()) {
    if (posts.length < 4) continue;
    creatorsScanned++;
    addCreatorRows(posts, likesDS, viewsDS);
  }

  // 3) Fit + persist. Need a reasonable number of rows to bother.
  const trained_at = new Date().toISOString();
  const report: TrainReport = {
    likes: { trained: false, rmse: 0, r2: 0, n_samples: likesDS.y.length },
    views: { trained: false, rmse: 0, r2: 0, n_samples: viewsDS.y.length },
    creators_scanned: creatorsScanned,
    trained_at,
  };

  await ensureTable(db);

  if (likesDS.y.length >= 40) {
    const model = trainRidge(likesDS.X, likesDS.y, [...LIKES_FEATURES], { lambda: 2.0 });
    await saveModel(db, 'likes', model);
    report.likes = { trained: true, rmse: model.rmse, r2: model.r2, n_samples: model.n_samples };
  }
  if (viewsDS.y.length >= 40) {
    const model = trainRidge(viewsDS.X, viewsDS.y, [...VIEWS_FEATURES], { lambda: 2.0 });
    await saveModel(db, 'views', model);
    report.views = { trained: true, rmse: model.rmse, r2: model.r2, n_samples: model.n_samples };
  }
  reachModelCache = null; // invalidate inference cache after a retrain
  return report;
}

// ── persistence + inference-side loading ────────────────────────────────────

async function ensureTable(db: ReturnType<typeof getBolticClient>): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS ml_reach_weights (
       id          text PRIMARY KEY,
       model       jsonb NOT NULL,
       n_samples   integer NOT NULL DEFAULT 0,
       rmse        double precision,
       r2          double precision,
       trained_at  timestamptz NOT NULL DEFAULT now()
     )`,
  ).catch(() => {});
}

async function saveModel(db: ReturnType<typeof getBolticClient>, id: 'likes' | 'views', model: RidgeModel): Promise<void> {
  await db.query(
    `INSERT INTO ml_reach_weights (id, model, n_samples, rmse, r2, trained_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       model = EXCLUDED.model, n_samples = EXCLUDED.n_samples,
       rmse = EXCLUDED.rmse, r2 = EXCLUDED.r2, trained_at = now()`,
    [id, JSON.stringify(model), model.n_samples, model.rmse, model.r2],
  );
}

export interface LoadedReachModels {
  likes: RidgeModel | null;
  views: RidgeModel | null;
  trained_at: string | null;
}

// Module-scoped cache with a short TTL — avoids a DB round-trip on every
// prediction while still picking up retrains within a minute.
let reachModelCache: { at: number; models: LoadedReachModels } | null = null;
const CACHE_TTL_MS = 60_000;

export async function loadReachModels(): Promise<LoadedReachModels> {
  if (reachModelCache && Date.now() - reachModelCache.at < CACHE_TTL_MS) return reachModelCache.models;
  const db = getBolticClient();
  const models: LoadedReachModels = { likes: null, views: null, trained_at: null };
  try {
    const rows = await db.query<{ id: string; model: unknown; trained_at: string }>(
      `SELECT id, model, trained_at FROM ml_reach_weights WHERE id IN ('likes','views')`,
    );
    for (const r of rows) {
      const parsed = (typeof r.model === 'string' ? JSON.parse(r.model) : r.model) as RidgeModel;
      if (r.id === 'likes') models.likes = parsed;
      if (r.id === 'views') models.views = parsed;
      if (!models.trained_at || r.trained_at > models.trained_at) models.trained_at = r.trained_at;
    }
  } catch {
    // Table may not exist yet (model never trained) — inference falls back.
  }
  reachModelCache = { at: Date.now(), models };
  return models;
}

// Convert a model's log-residual output into a bounded multiplier on the
// creator's baseline. exp(residual), clamped so a single content signal can
// never swing the prediction more than ~2.4× either way.
const MULT_LO = 0.42; // ≈ e^-0.87
const MULT_HI = 2.4;  // ≈ e^0.87

export function likesMultiplier(model: RidgeModel | null, f: ContentFeatures): number {
  if (!model) return 1;
  const out = predict(model, likesFeatureRow(f));
  return Math.max(MULT_LO, Math.min(MULT_HI, Math.exp(out)));
}

export function viewsMultiplier(model: RidgeModel | null, f: ContentFeatures): number {
  if (!model) return 1;
  const out = predict(model, viewsFeatureRow(f));
  return Math.max(MULT_LO, Math.min(MULT_HI, Math.exp(out)));
}
