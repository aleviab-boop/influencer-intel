// ============================================================
// Follower-growth projection.
//
// The dashboard already charts follower history from daily snapshots; this
// reads the same series and looks FORWARD: at the current pace, where does the
// creator land in 30/60/90 days, and when do they cross their next milestone?
//
// A deliberately TRANSPARENT model — a least-squares line through the daily
// snapshots, not a black box. Two snapshots on different days is the minimum;
// the fit sharpens as history accrues. Everything is directional and labelled
// as such: it assumes the recent pace holds, which real accounts rarely do
// perfectly. Pure — computed from the snapshot series the route already built.
// ============================================================

export interface GrowthPoint {
  date: string;        // YYYY-MM-DD
  followers: number;
}

export interface GrowthProjection {
  available: boolean;
  sample_days: number;                 // span covered by the snapshots
  current: number | null;
  daily_rate: number | null;           // avg followers gained per day (can be < 0)
  weekly_pct: number | null;           // % growth per week
  trend: 'growing' | 'flat' | 'declining' | null;
  projections: { in_days: number; date: string; followers: number }[];   // 30/60/90
  next_milestone: { target: number; in_days: number | null; date: string | null } | null;
  headline: string | null;
}

const DAY_MS = 86_400_000;

function addDays(fromISO: string, days: number): string {
  const t = new Date(fromISO + 'T00:00:00Z').getTime();
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

// Next "nice" follower milestone above the current count.
function nextMilestone(current: number): number {
  const step = current < 10_000 ? 1_000
    : current < 100_000 ? 10_000
      : current < 1_000_000 ? 50_000
        : 100_000;
  return Math.floor(current / step) * step + step;
}

export function projectGrowth(series: GrowthPoint[], currentOverride?: number | null): GrowthProjection {
  // One snapshot per day (last wins), chronological.
  const byDay = new Map<string, number>();
  for (const p of series) {
    const day = (p.date ?? '').slice(0, 10);
    const f = Number(p.followers);
    if (day && Number.isFinite(f) && f > 0) byDay.set(day, f);
  }
  const points = [...byDay.entries()]
    .map(([date, followers]) => ({ date, followers }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const empty: GrowthProjection = {
    available: false, sample_days: points.length, current: currentOverride ?? (points.at(-1)?.followers ?? null),
    daily_rate: null, weekly_pct: null, trend: null, projections: [], next_milestone: null, headline: null,
  };
  if (points.length < 2) return empty;

  // Regress followers against days since the first snapshot.
  const t0 = new Date(points[0]!.date + 'T00:00:00Z').getTime();
  const xs = points.map((p) => (new Date(p.date + 'T00:00:00Z').getTime() - t0) / DAY_MS);
  const ys = points.map((p) => p.followers);
  const spanDays = xs.at(-1)!;
  if (spanDays < 1) return empty;   // all snapshots on the same day → no slope

  const n = points.length;
  const sumX = xs.reduce((s, v) => s + v, 0);
  const sumY = ys.reduce((s, v) => s + v, 0);
  const sumXY = xs.reduce((s, v, i) => s + v * ys[i]!, 0);
  const sumXX = xs.reduce((s, v) => s + v * v, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return empty;

  const slope = (n * sumXY - sumX * sumY) / denom;   // followers/day
  const current = currentOverride ?? points.at(-1)!.followers;
  const lastDate = points.at(-1)!.date;

  const dailyRate = Math.round(slope * 10) / 10;
  const weeklyPct = current > 0 ? Math.round((slope * 7 / current) * 1000) / 10 : null;

  const trend: GrowthProjection['trend'] =
    weeklyPct == null ? 'flat'
      : weeklyPct > 0.3 ? 'growing'
        : weeklyPct < -0.3 ? 'declining'
          : 'flat';

  const projections = [30, 60, 90].map((d) => ({
    in_days: d,
    date: addDays(lastDate, d),
    followers: Math.max(0, Math.round(current + slope * d)),
  }));

  // Milestone ETA (only meaningful while genuinely growing).
  let next_milestone: GrowthProjection['next_milestone'] = null;
  const target = nextMilestone(current);
  if (slope > 0) {
    const days = Math.ceil((target - current) / slope);
    next_milestone = { target, in_days: days, date: addDays(lastDate, days) };
  } else {
    next_milestone = { target, in_days: null, date: null };
  }

  const fmt = (v: number): string =>
    v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : v >= 1_000 ? (v / 1_000).toFixed(1) + 'K' : String(v);

  let headline: string | null;
  if (trend === 'growing') {
    const perWeek = Math.round(slope * 7);
    headline = `At your current pace you're adding ~${perWeek.toLocaleString('en-IN')} followers/week` +
      (next_milestone?.in_days != null ? ` — on track to hit ${fmt(target)} in about ${next_milestone.in_days} days.` : '.');
  } else if (trend === 'declining') {
    headline = `Your follower count is drifting down ~${Math.abs(Math.round(slope * 7)).toLocaleString('en-IN')}/week — worth a consistency push to reverse it.`;
  } else {
    headline = `Your follower count is holding roughly flat — a cadence or content change could restart growth.`;
  }

  return {
    available: true,
    sample_days: Math.round(spanDays) + 1,
    current,
    daily_rate: dailyRate,
    weekly_pct: weeklyPct,
    trend,
    projections,
    next_milestone,
    headline,
  };
}
