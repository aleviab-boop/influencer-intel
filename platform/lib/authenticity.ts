// ============================================================
// Authenticity scoring — estimates how genuine a creator's audience/engagement
// looks, on a 0–100 scale. Prefers a per-post analysis of recent_posts[]
// (median engagement, comments-per-like, consistency) and falls back to
// profile averages when post-level data is missing. This is a heuristic
// estimate of engagement quality, NOT a literal fake-follower percentage.
// ============================================================

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// Realistic engagement-rate benchmark by follower tier (percent).
const tierTarget = (f: number): number =>
  f >= 1e6 ? 1 : f >= 5e5 ? 1.3 : f >= 1e5 ? 1.8 : f >= 5e4 ? 2.5 : f >= 2e4 ? 3.5 : f >= 1e4 ? 4.5 : 6;

// Coefficient of variation → consistency score. Organic engagement is moderately
// spiky; suspiciously *uniform* engagement (pods/bots) or a single viral spike
// both read as less authentic.
function consistencyScore(cv: number): number {
  if (cv < 0.12) return 45;   // eerily flat
  if (cv < 0.3) return 75;
  if (cv <= 1.5) return 100;  // healthy organic variance
  if (cv <= 2.5) return 80;   // a bit spiky / one big post
  return 60;                  // very erratic
}

export interface RecentPost {
  like_count?: number | string | null;
  comment_count?: number | string | null;
  view_count?: number | string | null;
  posted_at?: string | null;
}

export interface AuthenticityInput {
  follower_count?: number | string | null;
  following_count?: number | string | null;
  avg_likes?: number | string | null;
  avg_comments?: number | string | null;
  engagement_rate?: number | string | null;
  cred_score?: number | string | null;
  recent_posts?: RecentPost[] | null;
}

export interface AuthenticitySignal { label: string; ok: boolean; detail: string }
export interface AuthenticityResult {
  score: number;            // 0–100
  band: 'high' | 'mixed' | 'low';
  basis: 'per_post' | 'aggregate';
  posts_analyzed: number;
  signals: AuthenticitySignal[];
}

function bandOf(score: number): 'high' | 'mixed' | 'low' {
  return score >= 80 ? 'high' : score >= 55 ? 'mixed' : 'low';
}

// Follower/following ratio sub-score: mass-following accounts (ratio < 1) read
// as low quality; a healthy ratio caps out the score.
function ffScore(followers: number, following: number): { score: number; ratio: number } {
  const ratio = following > 0 ? followers / following : followers > 0 ? 999 : 1;
  const score = clamp(ratio >= 1 ? 70 + Math.min(30, (ratio - 1) * 8) : ratio * 70, 0, 100);
  return { score, ratio };
}

export function scoreAuthenticity(input: AuthenticityInput): AuthenticityResult {
  const followers = num(input.follower_count) ?? 0;
  const following = num(input.following_count) ?? 0;
  const cred = num(input.cred_score);
  const target = tierTarget(followers);
  const { score: ffSc, ratio: ff } = ffScore(followers, following);

  // Build per-post series when we have enough posts with engagement data.
  const posts = (input.recent_posts ?? [])
    .map((p) => ({ likes: num(p.like_count) ?? 0, comments: num(p.comment_count) ?? 0 }))
    .filter((p) => p.likes + p.comments > 0);

  const usePerPost = followers > 0 && posts.length >= 3;

  const signals: AuthenticitySignal[] = [];

  if (usePerPost) {
    const ers = posts.map((p) => ((p.likes + p.comments) / followers) * 100);
    const cpls = posts.filter((p) => p.likes > 0).map((p) => p.comments / p.likes);
    const medER = median(ers);
    const medCPL = cpls.length ? median(cpls) : 0;

    const mean = ers.reduce((a, b) => a + b, 0) / ers.length;
    const variance = ers.reduce((a, b) => a + (b - mean) ** 2, 0) / ers.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    const erScore = clamp((medER / Math.max(0.1, target)) * 100, 0, 100);
    const cplScore = clamp((medCPL / 0.015) * 100, 0, 100);
    const consScore = consistencyScore(cv);

    const parts = cred != null
      ? [erScore * 0.4, cplScore * 0.25, consScore * 0.15, ffSc * 0.1, cred * 0.1]
      : [erScore * 0.45, cplScore * 0.28, consScore * 0.17, ffSc * 0.1];
    const score = Math.round(parts.reduce((a, b) => a + b, 0));

    signals.push(
      { label: 'Engagement vs tier', ok: medER >= target * 0.6, detail: `${medER.toFixed(2)}% median (benchmark ${target.toFixed(1)}%)` },
      { label: 'Comment authenticity', ok: medCPL >= 0.005, detail: `${(medCPL * 100).toFixed(2)}% comments-per-like` },
      { label: 'Engagement consistency', ok: consScore >= 75, detail: cv < 0.12 ? 'unusually uniform — possible pods' : cv > 2.5 ? 'erratic / one-off spike' : 'steady across posts' },
      { label: 'Follower / following ratio', ok: ff >= 1, detail: ff >= 999 ? 'follows almost no one' : `${ff.toFixed(1)}×` },
      ...(cred != null ? [{ label: 'Credibility score', ok: cred >= 70, detail: `${Math.round(cred)}/100` }] : []),
    );

    return { score, band: bandOf(score), basis: 'per_post', posts_analyzed: posts.length, signals };
  }

  // ---- Aggregate fallback (profile averages) ----
  const avgLikes = num(input.avg_likes) ?? 0;
  const avgComments = num(input.avg_comments) ?? 0;
  const er = num(input.engagement_rate) != null
    ? (num(input.engagement_rate) as number) * 100
    : followers > 0 ? ((avgLikes + avgComments) / followers) * 100 : 0;
  const commentRatio = avgLikes > 0 ? avgComments / avgLikes : 0;

  const erScore = clamp((er / Math.max(0.1, target)) * 100, 0, 100);
  const cplScore = clamp((commentRatio / 0.015) * 100, 0, 100);

  const parts = cred != null
    ? [erScore * 0.4, cplScore * 0.2, ffSc * 0.2, cred * 0.2]
    : [erScore * 0.5, cplScore * 0.25, ffSc * 0.25];
  const score = Math.round(parts.reduce((a, b) => a + b, 0));

  signals.push(
    { label: 'Engagement vs tier', ok: er >= target * 0.6, detail: `${er.toFixed(2)}% (benchmark ${target.toFixed(1)}%)` },
    { label: 'Comment authenticity', ok: commentRatio >= 0.005, detail: `${(commentRatio * 100).toFixed(2)}% comments-per-like` },
    { label: 'Follower / following ratio', ok: ff >= 1, detail: ff >= 999 ? 'follows almost no one' : `${ff.toFixed(1)}×` },
    ...(cred != null ? [{ label: 'Credibility score', ok: cred >= 70, detail: `${Math.round(cred)}/100` }] : []),
  );

  return { score, band: bandOf(score), basis: 'aggregate', posts_analyzed: 0, signals };
}
