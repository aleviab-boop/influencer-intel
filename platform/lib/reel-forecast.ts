// ============================================================
// Reel performance forecast + content-depth analytics.
//
// A deliberately TRANSPARENT, deterministic model — not a black-box ML net.
// With only ~18 recent posts per creator there isn't enough data to train
// (or trust) a learned model, so we use robust statistics that a creator can
// actually reason about:
//
//   • baseline  = MEDIAN of recent reels (robust to one viral outlier)
//   • momentum  = recent-half avg vs older-half avg (are they heating up?)
//   • forecast  = blend of recent-average and median, nudged by momentum
//   • band      = ± one standard deviation (their normal variability)
//   • trend     = rising / steady / cooling from the momentum sign
//
// Everything is computed from the live posts the analytics route already
// fetched — no extra Graph calls, no new tables.
// ============================================================

export interface ForecastPost {
  id: string;
  media_type: string;
  permalink: string;
  thumbnail_url: string | null;
  media_url: string | null;
  timestamp: string;
  like_count: number;
  comments_count: number;
  er: number | null;
  reach: number | null;
  plays: number | null;
}

export interface ReelForecast {
  sample_size: number;
  median_plays: number | null;
  median_er: number | null;
  trend: 'rising' | 'steady' | 'cooling' | null;
  momentum_pct: number | null;
  consistency: number | null; // 0..1 — how predictable their reel output is
  next_reel: {
    plays_expected: number | null;
    plays_low: number | null;
    plays_high: number | null;
    er_expected: number | null;
  } | null;
  scorecard: { breakout: number; strong: number; average: number; soft: number };
  last_reel_band: 'breakout' | 'strong' | 'average' | 'soft' | null;
  top_reel: { plays: number; er: number | null; permalink: string; thumbnail: string | null } | null;
}

export interface ContentTypeStat {
  type: 'reels' | 'photos' | 'carousels';
  count: number;
  avg_er: number | null;
  avg_reach: number | null;
  avg_plays: number | null;
}

export interface ContentBreakdown {
  by_type: ContentTypeStat[];
  best_type: 'reels' | 'photos' | 'carousels' | null; // highest avg ER with >=2 posts
}

const isReel = (t: string): boolean => t === 'VIDEO' || t === 'REELS';
const isCarousel = (t: string): boolean => t === 'CAROUSEL_ALBUM';

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
const mean = (nums: number[]): number | null =>
  nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
function stdev(nums: number[]): number {
  const m = mean(nums);
  if (m == null || nums.length < 2) return 0;
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / (nums.length - 1));
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function bandFor(ratio: number): 'breakout' | 'strong' | 'average' | 'soft' {
  if (ratio >= 1.5) return 'breakout';
  if (ratio >= 1.15) return 'strong';
  if (ratio >= 0.85) return 'average';
  return 'soft';
}

/**
 * Forecast a creator's reel performance from their recent reels. Needs at
 * least 3 reels with play counts; returns a `null`-heavy shell otherwise so
 * the UI can show a friendly "not enough reels yet" state.
 */
export function forecastReels(posts: ForecastPost[]): ReelForecast {
  // Reels with a real play count, oldest → newest (chronological for momentum).
  const reels = posts
    .filter((p) => isReel(p.media_type) && p.plays != null && p.plays > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const empty: ReelForecast = {
    sample_size: reels.length,
    median_plays: null, median_er: null, trend: null, momentum_pct: null,
    consistency: null, next_reel: null,
    scorecard: { breakout: 0, strong: 0, average: 0, soft: 0 },
    last_reel_band: null, top_reel: null,
  };
  if (reels.length < 3) return empty;

  const plays = reels.map((r) => r.plays!);
  const ers = reels.map((r) => r.er).filter((v): v is number => v != null);

  const medPlays = median(plays)!;
  const medEr = median(ers);

  // Momentum: recent half vs older half of the play series.
  const half = Math.floor(reels.length / 2);
  const older = plays.slice(0, half);
  const recent = plays.slice(reels.length - half);
  const olderAvg = mean(older);
  const recentAvg = mean(recent) ?? medPlays;
  const momentumPct = olderAvg && olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

  const trend: ReelForecast['trend'] =
    momentumPct > 10 ? 'rising' : momentumPct < -10 ? 'cooling' : 'steady';

  // Point forecast: blend recent-average (60%) with the robust median (40%).
  const expected = Math.round(0.6 * recentAvg + 0.4 * medPlays);
  const sd = stdev(plays);
  const low = Math.max(0, Math.round(expected - sd));
  const high = Math.round(expected + sd);

  // Consistency = 1 − coefficient of variation, clamped. High = predictable.
  const avgAll = mean(plays)!;
  const consistency = avgAll > 0 ? clamp(1 - sd / avgAll, 0, 1) : null;

  // Per-reel bands vs their own median (the "how are my reels doing" scorecard).
  const scorecard = { breakout: 0, strong: 0, average: 0, soft: 0 };
  for (const p of plays) scorecard[bandFor(p / medPlays)] += 1;
  const lastBand = bandFor(plays[plays.length - 1]! / medPlays);

  const topIdx = plays.reduce((best, v, i) => (v > plays[best]! ? i : best), 0);
  const topR = reels[topIdx]!;

  return {
    sample_size: reels.length,
    median_plays: Math.round(medPlays),
    median_er: medEr,
    trend,
    momentum_pct: Math.round(momentumPct * 10) / 10,
    consistency: consistency != null ? Math.round(consistency * 100) / 100 : null,
    next_reel: {
      plays_expected: expected,
      plays_low: low,
      plays_high: high,
      er_expected: medEr,
    },
    scorecard,
    last_reel_band: lastBand,
    top_reel: {
      plays: topR.plays!,
      er: topR.er,
      permalink: topR.permalink,
      thumbnail: topR.thumbnail_url ?? topR.media_url,
    },
  };
}

/** Average ER / reach / plays per content format, and which format wins. */
export function contentBreakdown(posts: ForecastPost[]): ContentBreakdown {
  const groups: Record<ContentTypeStat['type'], ForecastPost[]> = {
    reels: posts.filter((p) => isReel(p.media_type)),
    carousels: posts.filter((p) => isCarousel(p.media_type)),
    photos: posts.filter((p) => !isReel(p.media_type) && !isCarousel(p.media_type)),
  };

  const by_type: ContentTypeStat[] = (Object.keys(groups) as ContentTypeStat['type'][]).map((type) => {
    const g = groups[type];
    const ers = g.map((p) => p.er).filter((v): v is number => v != null);
    const reaches = g.map((p) => p.reach).filter((v): v is number => v != null && v > 0);
    const plays = g.map((p) => p.plays).filter((v): v is number => v != null && v > 0);
    return {
      type,
      count: g.length,
      avg_er: ers.length ? ers.reduce((s, v) => s + v, 0) / ers.length : null,
      avg_reach: reaches.length ? Math.round(reaches.reduce((s, v) => s + v, 0) / reaches.length) : null,
      avg_plays: plays.length ? Math.round(plays.reduce((s, v) => s + v, 0) / plays.length) : null,
    };
  });

  // Best format = highest avg ER among types with a meaningful sample (>=2).
  let best_type: ContentBreakdown['best_type'] = null;
  let bestEr = -1;
  for (const s of by_type) {
    if (s.count >= 2 && s.avg_er != null && s.avg_er > bestEr) {
      bestEr = s.avg_er;
      best_type = s.type;
    }
  }

  return { by_type, best_type };
}
