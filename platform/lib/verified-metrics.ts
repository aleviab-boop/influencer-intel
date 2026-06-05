// ============================================================
// Verified metrics — reach-based engagement from OAuth-synced post insights.
// When a creator connects via Instagram OAuth, the sync worker stores per-post
// reach/saves/shares/interactions in post_insights. Follower-based ER divides
// by follower count (inflated by ghosts/bots); reach-based ER divides by the
// people actually reached, which is the number brands trust. This module
// derives that on-read, so it lights up the moment an account syncs.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface InsightRow {
  reach?: number | string | null;
  total_interactions?: number | string | null;
  like_count?: number | string | null;
  comment_count?: number | string | null;
  saved?: number | string | null;
  shares?: number | string | null;
}

export interface VerifiedEngagement {
  posts: number;
  er_pct: number;       // median reach-based engagement rate (% of reach)
  cpl_pct: number;      // median comments-per-like (%)
  avg_reach: number;
}

// Pure: compute reach-based engagement stats from a set of post-insight rows.
// Returns null when no post has usable reach data.
export function computeReachEngagement(rows: InsightRow[]): VerifiedEngagement | null {
  const usable = rows
    .map((r) => {
      const reach = num(r.reach) ?? 0;
      const likes = num(r.like_count) ?? 0;
      const comments = num(r.comment_count) ?? 0;
      const inter = num(r.total_interactions) ?? (likes + comments + (num(r.saved) ?? 0) + (num(r.shares) ?? 0));
      return { reach, likes, comments, inter };
    })
    .filter((r) => r.reach > 0);

  if (usable.length === 0) return null;

  const ers = usable.map((r) => (r.inter / r.reach) * 100);
  const cpls = usable.filter((r) => r.likes > 0).map((r) => (r.comments / r.likes) * 100);
  const avgReach = usable.reduce((s, r) => s + r.reach, 0) / usable.length;

  return {
    posts: usable.length,
    er_pct: median(ers),
    cpl_pct: cpls.length ? median(cpls) : 0,
    avg_reach: Math.round(avgReach),
  };
}

// Load a creator's recent verified post insights and derive reach-based stats.
// Returns null when the creator has no OAuth-synced reach data.
export async function getVerifiedEngagement(handle: string): Promise<VerifiedEngagement | null> {
  const db = getBolticClient();
  const rows = await db.query<InsightRow>(
    `SELECT pi.reach, pi.total_interactions, pi.like_count, pi.comment_count, pi.saved, pi.shares
     FROM post_insights pi
     JOIN creators c ON c.id = pi.creator_id
     WHERE LOWER(c.handle) = $1 AND pi.reach IS NOT NULL AND pi.reach > 0
     ORDER BY pi.posted_at DESC NULLS LAST
     LIMIT 30`,
    [handle.trim().replace(/^@/, '').toLowerCase()],
  );
  return computeReachEngagement(rows);
}
