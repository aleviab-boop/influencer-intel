// ============================================================
// fetch-engagement.mjs  —  the "Fetcher"
//
// ~70% of creators have NO engagement data (null engagement_rate / avg_likes /
// avg_comments, empty recent_posts). This fills that gap using the same free
// cookie path the drawer uses: web_profile_info (profile + recent posts) with a
// logged-in session cookie, computing avg likes/comments + ER from the recent
// posts, and — when web_profile_info returns an empty posts array — falling back
// to the user-feed endpoint (same as /api/ig-profile).
//
// Single session + single IP = low volume: IG rate-limits after a while, so this
// is GENTLE and RESUMABLE — it processes null-ER creators highest-followers-first,
// paces itself, and stops cleanly on a dead cookie (401) or sustained 429s. Run
// it again (or on a cron) to keep filling where it left off.
//
// Run:  cd platform && node --env-file=.env scripts/fetch-engagement.mjs
// Env:  FETCH_BATCH (default 150)  FETCH_DELAY_MS (default 6000)  DRY_RUN=1
// Needs IG_SESSIONID (+ IG_DS_USER_ID / IG_CSRFTOKEN) in .env. Runs on a
// residential IP (your machine) — do NOT run from a data-center box.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { notifySlack } from '@influencer-intel/shared/notify';

const db = getBolticClient();
const BATCH = Number(process.env.FETCH_BATCH ?? 150);
const DELAY = Number(process.env.FETCH_DELAY_MS ?? 6000);
const DRY = process.env.DRY_RUN === '1';

const SID = process.env.IG_SESSIONID?.trim();
if (!SID) { console.error('[fetcher] IG_SESSIONID missing in .env'); process.exit(1); }
const cookie = [
  `sessionid=${SID}`,
  process.env.IG_DS_USER_ID?.trim() ? `ds_user_id=${process.env.IG_DS_USER_ID.trim()}` : '',
  process.env.IG_CSRFTOKEN?.trim() ? `csrftoken=${process.env.IG_CSRFTOKEN.trim()}` : '',
].filter(Boolean).join('; ');

// Full header set — undici auto-adds Sec-Fetch-* headers IG rejects with 400, so
// we override them to look like a same-origin XHR (matches /api/ig-profile).
const HEADERS = {
  'x-ig-app-id': '936619743392459',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.instagram.com/',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Cookie: cookie,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => DELAY + Math.floor(Math.random() * 4000);
const mean = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    return { status: r.status, json: r.ok ? await r.json() : null };
  } catch {
    return { status: 0, json: null };
  } finally {
    clearTimeout(t);
  }
}

// Recent posts → normalized [{shortcode, likes, comments, is_video, taken_at}].
function postsFromProfile(user) {
  const edges = user?.edge_owner_to_timeline_media?.edges ?? [];
  return edges.map((e) => {
    const n = e.node ?? {};
    return {
      shortcode: n.shortcode ?? '',
      likes: n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0,
      comments: n.edge_media_to_comment?.count ?? 0,
      is_video: !!n.is_video,
      taken_at: n.taken_at_timestamp ?? null,
    };
  });
}
function postsFromFeed(items) {
  return (items ?? []).map((it) => ({
    shortcode: it.code ?? '',
    likes: typeof it.like_count === 'number' ? it.like_count : 0,
    comments: typeof it.comment_count === 'number' ? it.comment_count : 0,
    is_video: it.media_type === 2,
    taken_at: typeof it.taken_at === 'number' ? it.taken_at : null,
  }));
}

async function enrich(handle) {
  const prof = await fetchJson(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`);
  if (prof.status === 401 || prof.status === 403) return { fatal: 'dead' };
  if (prof.status === 429) return { rateLimited: true };
  const user = prof.json?.data?.user;
  if (!user) return { skip: prof.status };

  const followers = user.edge_followed_by?.count ?? null;
  const postsCount = user.edge_owner_to_timeline_media?.count ?? null;
  let posts = postsFromProfile(user);

  // web_profile_info often returns an empty posts array once the session is
  // warmed — fall back to the user-feed endpoint (same as the drawer).
  if (posts.length === 0 && user.id) {
    const feed = await fetchJson(`https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(user.id)}/?count=12`);
    if (feed.status === 429) return { rateLimited: true };
    posts = postsFromFeed(feed.json?.items);
  }

  const likes = posts.map((p) => p.likes).filter((n) => n > 0);
  const comments = posts.map((p) => p.comments).filter((n) => n >= 0);
  const avgLikes = mean(likes);
  const avgComments = mean(comments);
  // ER stored as a FRACTION (0.0264 = 2.64%) to match existing data.
  const er = followers && followers > 0 && avgLikes > 0
    ? Math.min(9.9999, (avgLikes + avgComments) / followers)
    : null;

  return {
    followers,
    postsCount,
    avgLikes: avgLikes || null,
    avgComments: avgComments || null,
    er,
    recent: posts.slice(0, 12),
  };
}

async function main() {
  const rows = await db.query(
    `SELECT handle FROM creators
     WHERE platform='instagram' AND is_active=true AND engagement_rate IS NULL
     ORDER BY follower_count DESC NULLS LAST
     LIMIT ${BATCH}`,
  );
  console.log(`[fetcher] ${rows.length} creators to enrich${DRY ? ' (DRY RUN)' : ''} (delay ~${DELAY}ms).`);
  if (DRY) { console.log(rows.slice(0, 10).map((r) => r.handle).join(', '), '…'); process.exit(0); }

  let filled = 0, skipped = 0, rl = 0, i = 0;
  for (const { handle } of rows) {
    i++;
    const res = await enrich(handle);
    if (res.fatal === 'dead') {
      console.error(`[fetcher] session DEAD (401) at @${handle} — refresh IG_SESSIONID and re-run. Stopping.`);
      await notifySlack(
        `:rotating_light: *IG drawer cookie expired* — the Fetcher hit HTTP 401 at @${handle} and stopped. ` +
          `Engagement backfill is paused and the profile drawer will show blank posts/ER until IG_SESSIONID is refreshed (local .env + Vercel).`,
      );
      break;
    }
    if (res.rateLimited) {
      rl++;
      console.warn(`[fetcher] 429 at @${handle} (${rl} in a row).`);
      if (rl >= 3) { console.error('[fetcher] sustained rate-limiting — stopping; resume later.'); break; }
      await sleep(jitter() * 3); // back off harder
      continue;
    }
    rl = 0;
    if (res.skip || res.er == null) { skipped++; await sleep(jitter()); continue; }

    await db.query(
      `UPDATE creators SET
         engagement_rate = $1,
         avg_likes       = COALESCE($2, avg_likes),
         avg_comments    = COALESCE($3, avg_comments),
         follower_count  = COALESCE($4, follower_count),
         posts_count     = COALESCE($5, posts_count),
         recent_posts    = $6::jsonb,
         last_scraped_at = now(),
         updated_at      = now()
       WHERE platform='instagram' AND handle=$7`,
      [res.er, res.avgLikes, res.avgComments, res.followers, res.postsCount, JSON.stringify(res.recent), handle],
    );
    filled++;
    if (i % 25 === 0 || filled === 1) {
      console.log(`   ${i}/${rows.length} — @${handle} ER ${(res.er * 100).toFixed(2)}% · filled ${filled}, skipped ${skipped}`);
    }
    await sleep(jitter());
  }
  console.log(`[fetcher] done — filled ${filled}, skipped ${skipped} of ${i} attempted.`);
  process.exit(0);
}

main().catch((e) => { console.error('[fetcher] failed:', e); process.exit(1); });
