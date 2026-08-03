// ============================================================
// backfill-engagement-apify.mjs  —  the PAID bulk Fetcher
//
// ~63% of active creators (3.5k+) have NO stored per-post engagement, so their
// ER / authenticity / posting analytics render blank. The free cookie Fetcher
// (fetch-engagement.mjs) fills this too, but it's single-IP, rate-limited, and
// stops the moment IG_SESSIONID expires. This is the paid complement: it bulk-
// fills engagement via Apify's cheapest posts actor — sones/instagram-posts-
// scraper-lowcost (~$0.30 / 1k posts) — in batched runs, no cookie, no throttle
// babysitting. One-time ~$13 fills the whole gap; afterwards those creators serve
// rich analytics straight from the warm DB with no paid LIVE fetch per search.
//
// SAFE BY DEFAULT: this is a DRY RUN unless you pass GO=1 — it will not spend a
// cent or write a row until you opt in.
//
// Run (preview, free):  cd platform && node --env-file=.env scripts/backfill-engagement-apify.mjs
// Run (spend + write):  cd platform && GO=1 node --env-file=.env scripts/backfill-engagement-apify.mjs
// Env: LIMIT (default 200 targets) · BATCH (usernames per Apify run, default 40)
//      POSTS (posts per profile, default 12) · GO=1 to actually run/write.
// Needs APIFY_TOKEN + BOLTIC_DATABASE_URL in .env.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

const db = getBolticClient();
const TOKEN = process.env.APIFY_TOKEN?.trim();
const GO = process.env.GO === '1';
const LIMIT = Number(process.env.LIMIT ?? 200);
const BATCH = Number(process.env.BATCH ?? 40);
const POSTS = Number(process.env.POSTS ?? 12);
const ACTOR = 'sones~instagram-posts-scraper-lowcost';

if (!TOKEN) { console.error('[backfill] APIFY_TOKEN missing in .env'); process.exit(1); }

const mean = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Run the sones actor for a batch of usernames, get all their posts back in one
// billed run. Returns handle → [{shortcode, likes, comments, is_video, taken_at, caption}].
async function fetchPosts(handles) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(TOKEN)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180_000);
  let items = [];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: handles, postsPerProfile: POSTS }),
      signal: ctrl.signal,
    });
    if (!res.ok) { console.warn(`[backfill] actor HTTP ${res.status} for batch of ${handles.length}`); return new Map(); }
    items = await res.json();
  } catch (e) {
    console.warn('[backfill] actor call failed:', e.message);
    return new Map();
  } finally {
    clearTimeout(t);
  }

  const byHandle = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    // sones tags each post with the profile it was scraped from.
    const h = (it.scraped_username || it.user?.username || '').trim().toLowerCase();
    if (!h) continue;
    const post = {
      shortcode: it.code ?? '',
      likes: Number(it.like_count) || 0,
      comments: Number(it.comment_count) || 0,
      is_video: it.media_type === 2, // 1 image, 2 video, 8 carousel
      taken_at: typeof it.taken_at === 'number' ? it.taken_at : null,
      caption: (it.caption?.text ?? '').slice(0, 200),
    };
    if (!byHandle.has(h)) byHandle.set(h, []);
    byHandle.get(h).push(post);
  }
  return byHandle;
}

async function main() {
  // Targets: active creators with real reach but no usable per-post engagement.
  const rows = await db.query(
    `SELECT handle, follower_count FROM creators
      WHERE platform = 'instagram' AND is_active = true
        AND coalesce(follower_count, 0) > 0
        AND coalesce(jsonb_array_length(
              CASE WHEN jsonb_typeof(recent_posts::jsonb) = 'array' THEN recent_posts::jsonb ELSE '[]'::jsonb END
            ), 0) = 0
      ORDER BY follower_count DESC NULLS LAST
      LIMIT ${LIMIT}`,
  );
  const targets = rows.map((r) => r.handle.trim().toLowerCase()).filter(Boolean);
  const est = ((targets.length * POSTS) / 1000) * 0.3;

  console.log(`[backfill] ${targets.length} targets · ${POSTS} posts each · ~$${est.toFixed(2)} est. Apify cost`);
  if (!GO) {
    console.log('[backfill] DRY RUN — no spend, no writes. Sample:', targets.slice(0, 10).join(', '), '…');
    console.log('[backfill] Re-run with  GO=1  to actually fetch + write.');
    process.exit(0);
  }

  let filled = 0, empty = 0, done = 0;
  for (const batch of chunk(targets, BATCH)) {
    const posts = await fetchPosts(batch);
    for (const handle of batch) {
      done++;
      const recent = (posts.get(handle) ?? []).filter((p) => p.likes > 0 || p.comments > 0);
      if (recent.length === 0) { empty++; continue; }

      const avgLikes = mean(recent.map((p) => p.likes).filter((n) => n > 0));
      const avgComments = mean(recent.map((p) => p.comments));
      const { follower_count } = rows.find((r) => r.handle.toLowerCase() === handle) ?? {};
      const followers = Number(follower_count) || 0;
      // ER stored as a FRACTION (0.0264 = 2.64%) to match existing data.
      const er = followers > 0 && avgLikes > 0
        ? Math.min(9.9999, (avgLikes + avgComments) / followers)
        : null;

      await db.query(
        `UPDATE creators SET
           recent_posts    = $1::jsonb,
           avg_likes       = COALESCE($2, avg_likes),
           avg_comments    = COALESCE($3, avg_comments),
           engagement_rate = COALESCE($4, engagement_rate),
           last_scraped_at = now(),
           updated_at      = now()
         WHERE platform = 'instagram' AND lower(handle) = $5`,
        [JSON.stringify(recent), avgLikes || null, avgComments || null, er, handle],
      );
      filled++;
    }
    console.log(`   ${done}/${targets.length} — filled ${filled}, empty ${empty}`);
  }
  console.log(`[backfill] done — filled ${filled}, empty ${empty} of ${done} targets.`);
  process.exit(0);
}

main().catch((e) => { console.error('[backfill] failed:', e); process.exit(1); });
