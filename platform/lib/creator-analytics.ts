// ============================================================
// Deterministic creator analytics — computed from the raw scraped post data we
// ALREADY pull (followers + recent posts' likes/comments/timestamps/captions).
//
// Nothing here calls OpenAI or Apify. These are metrics, not guesses: an LLM
// can't measure engagement or detect a follower spike, so we compute them from
// real numbers. Repeatable, free, and honest.
//
//   analyzeAuthenticity()  → fake-engagement / bought-follower risk
//   analyzePosting()       → cadence, consistency, video share, best day
//   topHashtags()          → most-used hashtags from recent captions
//   campaignFit()          → single 0–100 "should I book them" score + breakdown
//
// Every input is coerced with Number()/String() because our Postgres driver
// returns NUMERIC/BIGINT columns as strings — doing math on those silently
// concatenates instead of adding.
// ============================================================

export interface PostSample {
  likes: number;
  comments: number;
  taken_at: number | null; // unix SECONDS
  caption: string;
  is_video?: boolean;
}

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

// Normalize a loosely-typed post (from any of the drawer paths) into a PostSample.
export function toPostSample(p: {
  likes?: unknown;
  comments?: unknown;
  taken_at?: unknown;
  caption?: unknown;
  is_video?: unknown;
}): PostSample {
  return {
    likes: num(p.likes),
    comments: num(p.comments),
    taken_at: typeof p.taken_at === 'number' && Number.isFinite(p.taken_at) ? p.taken_at : null,
    caption: typeof p.caption === 'string' ? p.caption : '',
    is_video: Boolean(p.is_video),
  };
}

// ---- healthy engagement bands (industry rule-of-thumb, by follower tier) ----
// Returns [floor, ceiling] engagement-rate % that's considered normal for a
// creator of this size. Below the floor = dead/bought audience; way above the
// ceiling = inflated/pod engagement. Used by both authenticity and fit scoring.
function healthyERRange(followers: number): [number, number] {
  if (followers < 10_000) return [3, 12]; // nano/micro engage hard
  if (followers < 100_000) return [1.8, 8];
  if (followers < 500_000) return [1.2, 6];
  if (followers < 1_000_000) return [0.8, 5];
  return [0.5, 4]; // mega
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

// ============================================================
// 1) AUTHENTICITY / FAKE ENGAGEMENT
// ============================================================

export interface Authenticity {
  score: number; // 0–100, higher = more authentic
  label: 'authentic' | 'mostly authentic' | 'questionable' | 'high risk' | 'unknown';
  flags: string[]; // human-readable reasons for any deduction
  er: number | null; // engagement rate % we measured
  comment_ratio: number | null; // comments per like (real audiences comment; bots don't)
}

export function analyzeAuthenticity(followersRaw: unknown, postsIn: PostSample[]): Authenticity {
  const followers = num(followersRaw);
  const posts = postsIn.filter((p) => p.likes > 0 || p.comments > 0);
  if (followers <= 0 || posts.length < 3) {
    return { score: 0, label: 'unknown', flags: ['not enough post data to assess'], er: null, comment_ratio: null };
  }

  const likes = posts.map((p) => p.likes);
  const avgLikes = mean(likes);
  const avgComments = mean(posts.map((p) => p.comments));
  const er = Math.round(((avgLikes + avgComments) / followers) * 1000) / 10; // %
  const commentRatio = avgLikes > 0 ? avgComments / avgLikes : 0;
  const [floor, ceil] = healthyERRange(followers);

  let score = 100;
  const flags: string[] = [];

  // Engagement far below the healthy floor → dead or bought followers.
  if (er < floor * 0.5) {
    score -= 30;
    flags.push(`engagement (${er}%) is far below healthy for this size — possible inactive/bought followers`);
  } else if (er < floor) {
    score -= 12;
    flags.push(`engagement (${er}%) is a bit low for this size`);
  }

  // Implausibly high engagement → inflated likes or engagement pods.
  if (er > ceil * 1.8) {
    score -= 22;
    flags.push(`engagement (${er}%) is implausibly high — possible bought likes or pods`);
  }

  // Almost no comments per like → likes are cheap to buy, comments aren't.
  if (avgLikes > 200 && commentRatio < 0.003) {
    score -= 20;
    flags.push('very few comments relative to likes — a classic bought-likes signal');
  }

  // Like counts nearly identical across posts → automated/pod engagement.
  const cv = avgLikes > 0 ? stddev(likes) / avgLikes : 0;
  if (posts.length >= 4 && cv < 0.12) {
    score -= 20;
    flags.push('likes are suspiciously uniform across posts — automated engagement pattern');
  }

  if (flags.length === 0) flags.push('engagement metrics look natural for this creator size');

  score = clamp(Math.round(score));
  const label: Authenticity['label'] =
    score >= 80 ? 'authentic' : score >= 60 ? 'mostly authentic' : score >= 40 ? 'questionable' : 'high risk';

  return {
    score,
    label,
    flags,
    er,
    comment_ratio: Math.round(commentRatio * 1000) / 1000,
  };
}

// ============================================================
// 2) POSTING BEHAVIOUR
// ============================================================

export interface PostingBehaviour {
  posts_per_week: number | null;
  cadence_label: string;
  consistency: number | null; // 0–100 (how even the gaps between posts are)
  most_active_day: string | null; // e.g. "Thu"
  video_share: number | null; // % of recent posts that are video/reels
  span_days: number | null; // how many days the sampled posts cover
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function analyzePosting(postsIn: PostSample[]): PostingBehaviour {
  const dated = postsIn
    .filter((p) => p.taken_at != null)
    .map((p) => p.taken_at as number)
    .sort((a, b) => b - a); // newest first

  const video_share = postsIn.length
    ? Math.round((postsIn.filter((p) => p.is_video).length / postsIn.length) * 100)
    : null;

  if (dated.length < 2) {
    return {
      posts_per_week: null,
      cadence_label: 'unknown',
      consistency: null,
      most_active_day: null,
      video_share,
      span_days: null,
    };
  }

  const spanSec = dated[0]! - dated[dated.length - 1]!;
  const spanDays = spanSec / 86_400;
  const perWeek = spanDays > 0 ? Math.round(((dated.length - 1) / (spanDays / 7)) * 10) / 10 : null;

  // gaps between consecutive posts, in days → consistency from their variability
  const gaps: number[] = [];
  for (let i = 0; i < dated.length - 1; i++) gaps.push((dated[i]! - dated[i + 1]!) / 86_400);
  const gapMean = mean(gaps);
  const gapCv = gapMean > 0 ? stddev(gaps) / gapMean : 0;
  const consistency = clamp(Math.round(100 - gapCv * 60));

  // most active weekday
  const dayCounts = new Array(7).fill(0) as number[];
  for (const t of dated) dayCounts[new Date(t * 1000).getUTCDay()]!++;
  const topDay = dayCounts.indexOf(Math.max(...dayCounts));

  const cadence_label =
    perWeek == null ? 'unknown'
    : perWeek >= 7 ? 'multiple times daily'
    : perWeek >= 5 ? 'almost daily'
    : perWeek >= 3 ? `${Math.round(perWeek)}×/week`
    : perWeek >= 1 ? `${Math.round(perWeek)}×/week`
    : 'less than weekly';

  return {
    posts_per_week: perWeek,
    cadence_label,
    consistency,
    most_active_day: DAYS[topDay] ?? null,
    video_share,
    span_days: Math.round(spanDays),
  };
}

// ============================================================
// 3) HASHTAG ANALYSIS
// ============================================================

export interface HashtagStat {
  tag: string;
  count: number;
}

export function topHashtags(postsIn: PostSample[], limit = 12): HashtagStat[] {
  const counts = new Map<string, number>();
  for (const p of postsIn) {
    for (const m of p.caption.matchAll(/#([\p{L}0-9_]{2,50})/gu)) {
      const tag = m[1]!.toLowerCase();
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

// ============================================================
// 4) CAMPAIGN FIT SCORE
// ============================================================
// A single "should a brand book this creator for THIS brief" number, blending
// the four things that actually decide it. Every input is already computed
// upstream (niche relevance from the search gate, ER + authenticity from the
// posts, reach from followers) — this just weights them into one grade.

export interface CampaignFit {
  score: number; // 0–100
  grade: 'A' | 'B' | 'C' | 'D';
  breakdown: { niche: number; engagement: number; reach: number; authenticity: number };
}

// Map an engagement rate to 0–100 against the healthy band for the creator's
// size: at/above the floor scores well, below it falls off, absurdly high is
// capped (inflated engagement isn't a bonus).
function engagementScore(er: number | null, followers: number): number {
  if (er == null || er <= 0) return 0;
  const [floor, ceil] = healthyERRange(followers);
  if (er >= ceil) return 100;
  if (er <= floor * 0.4) return 15;
  // linear from floor*0.4 → ceil across 15 → 100
  const lo = floor * 0.4;
  return clamp(Math.round(15 + ((er - lo) / (ceil - lo)) * 85));
}

// Reach score rewards real audience size but plateaus — a 5M megastar isn't 50×
// more bookable than a healthy 100k micro-influencer for most campaigns.
function reachScore(followers: number): number {
  if (followers <= 0) return 0;
  if (followers >= 500_000) return 100;
  if (followers < 1_000) return 20;
  // log scale between 1k (≈40) and 500k (100)
  const s = 40 + ((Math.log10(followers) - 3) / (Math.log10(500_000) - 3)) * 60;
  return clamp(Math.round(s));
}

export function campaignFit(input: {
  followers: unknown;
  er: number | null; // engagement %
  nicheMatch: boolean | null | undefined; // did the profile match the brief's niche?
  authenticityScore: number; // 0–100 from analyzeAuthenticity (0 = unknown)
}): CampaignFit {
  const followers = num(input.followers);
  const niche = input.nicheMatch === true ? 100 : input.nicheMatch === false ? 35 : 60;
  const engagement = engagementScore(input.er, followers);
  const reach = reachScore(followers);
  // If authenticity is unknown (score 0 from too-little data), don't punish the
  // creator — treat it as a neutral 60 so a thin-but-real profile isn't graded D.
  const authenticity = input.authenticityScore > 0 ? input.authenticityScore : 60;

  const score = clamp(
    Math.round(0.35 * niche + 0.3 * engagement + 0.15 * reach + 0.2 * authenticity),
  );
  const grade: CampaignFit['grade'] = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D';

  return { score, grade, breakdown: { niche, engagement, reach, authenticity } };
}
