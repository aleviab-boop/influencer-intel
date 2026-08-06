// ============================================================
// Engagement trend over time.
//
// The reel forecast covers reels; this gives the WHOLE account a health check:
// is overall engagement (across every format) heating up or cooling off? We
// order the recent posts chronologically, compare the recent half against the
// older half, and expose a small ER series for a sparkline. Robust to a single
// viral outlier because we lean on the half-averages, not the peak.
//
// Pure — computed from posts the analytics route already fetched.
// ============================================================

export interface TrendPost {
  timestamp: string;   // ISO
  er: number | null;
}

export interface EngagementTrend {
  available: boolean;
  sample_size: number;
  series: { t: string; er: number }[];   // chronological, oldest → newest
  recent_avg: number | null;             // recent-half mean ER
  older_avg: number | null;              // older-half mean ER
  momentum_pct: number | null;           // (recent − older) / older × 100
  trend: 'rising' | 'steady' | 'cooling' | null;
  best: { t: string; er: number } | null;
  headline: string | null;
}

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

const MIN_SAMPLE = 5;

export function analyzeEngagementTrend(posts: TrendPost[]): EngagementTrend {
  const usable = posts
    .filter((p) => p.er != null && p.er > 0 && Number.isFinite(new Date(p.timestamp).getTime()))
    .map((p) => ({ t: p.timestamp, er: p.er as number }))
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  const empty: EngagementTrend = {
    available: false, sample_size: usable.length, series: [],
    recent_avg: null, older_avg: null, momentum_pct: null, trend: null,
    best: null, headline: null,
  };
  if (usable.length < MIN_SAMPLE) return empty;

  const ers = usable.map((p) => p.er);
  const half = Math.floor(usable.length / 2);
  const olderAvg = mean(ers.slice(0, half));
  const recentAvg = mean(ers.slice(usable.length - half));
  const momentumPct = olderAvg && olderAvg > 0 && recentAvg != null
    ? Math.round(((recentAvg - olderAvg) / olderAvg) * 1000) / 10
    : null;

  const trend: EngagementTrend['trend'] =
    momentumPct == null ? 'steady' : momentumPct > 10 ? 'rising' : momentumPct < -10 ? 'cooling' : 'steady';

  const bestIdx = ers.reduce((b, v, i) => (v > ers[b]! ? i : b), 0);
  const best = { t: usable[bestIdx]!.t, er: usable[bestIdx]!.er };

  let headline: string | null = null;
  if (momentumPct != null) {
    headline = trend === 'rising'
      ? `Your engagement is trending up ${momentumPct}% across recent posts — momentum is on your side.`
      : trend === 'cooling'
        ? `Your engagement has dipped ${Math.abs(momentumPct)}% recently — worth a fresh angle to re-engage your audience.`
        : `Your engagement is holding steady across recent posts.`;
  }

  return {
    available: true,
    sample_size: usable.length,
    series: usable,
    recent_avg: recentAvg,
    older_avg: olderAvg,
    momentum_pct: momentumPct,
    trend,
    best,
    headline,
  };
}
