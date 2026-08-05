// ============================================================
// Best-time-to-post analysis.
//
// With only ~24 recent posts, an hour-by-hour heatmap is too sparse to trust,
// so we aggregate two robust views a creator can actually act on:
//   • Day of week   — which weekday earns the most engagement.
//   • Time of day    — coarse parts (morning/midday/…) rather than exact hours.
//
// Timestamps from the Graph API are UTC; we convert to IST (UTC+5:30), the
// audience most of these creators post for. Everything is directional and
// labelled as such — we require a minimum sample before naming a "best".
// ============================================================

export interface TimePost {
  timestamp: string;      // ISO, UTC
  er: number | null;
}

export interface DayStat { day: number; label: string; count: number; avg_er: number | null }
export interface PartStat { key: string; label: string; range: string; count: number; avg_er: number | null }

export interface PostingTimeAnalysis {
  available: boolean;
  sample_size: number;
  timezone: string;                 // human label, e.g. "IST"
  by_day: DayStat[];                // Mon..Sun
  by_part: PartStat[];              // morning..night
  best_day: DayStat | null;
  best_part: PartStat | null;
  headline: string | null;         // e.g. "Weekday evenings work best for you"
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Coarse parts of the day (IST hours). Broad enough to hold a real sample.
const PARTS: { key: string; label: string; from: number; to: number; range: string }[] = [
  { key: 'early', label: 'Early morning', from: 5, to: 8, range: '5–8am' },
  { key: 'morning', label: 'Morning', from: 8, to: 12, range: '8am–12pm' },
  { key: 'midday', label: 'Midday', from: 12, to: 15, range: '12–3pm' },
  { key: 'afternoon', label: 'Afternoon', from: 15, to: 18, range: '3–6pm' },
  { key: 'evening', label: 'Evening', from: 18, to: 22, range: '6–10pm' },
  { key: 'night', label: 'Late night', from: 22, to: 5, range: '10pm–5am' },
];

const IST_OFFSET_MIN = 5 * 60 + 30;

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

function istParts(iso: string): { day: number; hour: number } | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ist = new Date(t + IST_OFFSET_MIN * 60_000);
  return { day: ist.getUTCDay(), hour: ist.getUTCHours() };
}

function partFor(hour: number): typeof PARTS[number] {
  for (const p of PARTS) {
    if (p.from < p.to) { if (hour >= p.from && hour < p.to) return p; }
    else if (hour >= p.from || hour < p.to) return p; // wraps midnight
  }
  return PARTS[PARTS.length - 1]!;
}

/** Minimum posts in a bucket before we'll call it a "best". */
const MIN_BUCKET = 2;
const MIN_SAMPLE = 6;

export function analyzePostingTime(posts: TimePost[]): PostingTimeAnalysis {
  const usable = posts
    .map((p) => ({ ...istParts(p.timestamp), er: p.er }))
    .filter((p): p is { day: number; hour: number; er: number | null } => p.day != null && p.hour != null);

  const empty: PostingTimeAnalysis = {
    available: false, sample_size: usable.length, timezone: 'IST',
    by_day: [], by_part: [], best_day: null, best_part: null, headline: null,
  };
  if (usable.length < MIN_SAMPLE) return empty;

  const erOf = (arr: { er: number | null }[]): number | null =>
    mean(arr.map((x) => x.er).filter((v): v is number => v != null && v > 0));

  // ---- By day of week (rendered Mon→Sun for readability) -----------------
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const by_day: DayStat[] = dayOrder.map((day) => {
    const g = usable.filter((p) => p.day === day);
    return { day, label: DAY_LABELS[day]!, count: g.length, avg_er: erOf(g) };
  });

  // ---- By part of day ----------------------------------------------------
  const by_part: PartStat[] = PARTS.map((part) => {
    const g = usable.filter((p) => partFor(p.hour).key === part.key);
    return { key: part.key, label: part.label, range: part.range, count: g.length, avg_er: erOf(g) };
  });

  const pickBest = <T extends { count: number; avg_er: number | null }>(arr: T[]): T | null => {
    let best: T | null = null;
    for (const s of arr) if (s.count >= MIN_BUCKET && s.avg_er != null && (best == null || s.avg_er > best.avg_er!)) best = s;
    return best;
  };
  const best_day = pickBest(by_day);
  const best_part = pickBest(by_part);

  // ---- Headline ----------------------------------------------------------
  let headline: string | null = null;
  if (best_day && best_part) {
    headline = `${best_day.label} ${best_part.label.toLowerCase()} (${best_part.range} IST) is your strongest posting window.`;
  } else if (best_part) {
    headline = `${best_part.label} (${best_part.range} IST) tends to work best for you.`;
  } else if (best_day) {
    headline = `${best_day.label} posts tend to perform best for you.`;
  }

  return {
    available: true,
    sample_size: usable.length,
    timezone: 'IST',
    by_day,
    by_part,
    best_day,
    best_part,
    headline,
  };
}
