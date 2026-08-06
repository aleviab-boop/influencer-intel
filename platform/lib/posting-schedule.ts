// ============================================================
// Posting schedule — the "best time to post" cards read the data one axis at a
// time (best day, best part-of-day). This crosses day × time-of-day into a grid
// and turns the strongest cells into a concrete WEEKLY PLAN: up to three slots
// like "Wednesday evening (6–9pm)", spread across different days, each with the
// engagement lift it has historically earned. It's the difference between an
// insight and a calendar the creator can actually post to.
//
// Pure and deterministic: avg ER per day×part cell over the timestamps the route
// fetched, in IST. No ML, no LLM. Falls back to a by-time-of-day plan when the
// day×part grid is too sparse to trust. Directional on a small sample.
// ============================================================

export interface SchedulePost {
  timestamp: string;   // ISO, UTC
  er: number | null;
}

export interface ScheduleSlot {
  day: number | null;        // 0=Sun … 6=Sat; null = "most days" (fallback)
  day_label: string;         // "Wednesday" | "Most days"
  part_key: string;
  part_label: string;        // "Evening"
  range: string;             // "6–9pm IST"
  avg_er: number | null;
  count: number;
  lift_pct: number | null;   // vs overall avg
}

export interface PostingSchedule {
  available: boolean;
  sample_size: number;
  timezone: 'IST';
  basis: 'day_time' | 'time_only' | null;
  slots: ScheduleSlot[];
  headline: string | null;
  tip: string | null;
}

const IST_OFFSET_MIN = 5 * 60 + 30;
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Part { key: string; label: string; range: string; lo: number; hi: number }
const PARTS: Part[] = [
  { key: 'morning', label: 'Morning', range: '6–11am IST', lo: 6, hi: 11 },
  { key: 'midday', label: 'Midday', range: '11am–3pm IST', lo: 11, hi: 15 },
  { key: 'afternoon', label: 'Afternoon', range: '3–6pm IST', lo: 15, hi: 18 },
  { key: 'evening', label: 'Evening', range: '6–9pm IST', lo: 18, hi: 21 },
  { key: 'night', label: 'Night', range: '9pm–12am IST', lo: 21, hi: 24 },
  { key: 'latenight', label: 'Late night', range: '12–6am IST', lo: 0, hi: 6 },
];

const MIN_SAMPLE = 8;
const MIN_CELL = 2;

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

function istParts(iso: string): { day: number; part: Part } | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + IST_OFFSET_MIN * 60_000);
  const hour = d.getUTCHours();
  const day = d.getUTCDay();
  const part = PARTS.find((p) => hour >= p.lo && hour < p.hi);
  return part ? { day, part } : null;
}

export function analyzePostingSchedule(posts: SchedulePost[]): PostingSchedule {
  const points = posts
    .map((p) => ({ meta: istParts(p.timestamp), er: p.er }))
    .filter((p): p is { meta: { day: number; part: Part }; er: number } => p.meta != null && p.er != null && p.er > 0);

  const empty: PostingSchedule = {
    available: false, sample_size: points.length, timezone: 'IST', basis: null,
    slots: [], headline: null, tip: null,
  };
  if (points.length < MIN_SAMPLE) return empty;

  const overall = mean(points.map((p) => p.er));
  if (overall == null || overall <= 0) return empty;
  const liftOf = (avg: number | null): number | null => (avg == null ? null : Math.round(((avg - overall) / overall) * 100));

  // ---- Tier A: day × part cells ------------------------------------------
  const cells = new Map<string, { day: number; part: Part; ers: number[] }>();
  for (const p of points) {
    const key = `${p.meta.day}|${p.meta.part.key}`;
    const c = cells.get(key) ?? { day: p.meta.day, part: p.meta.part, ers: [] };
    c.ers.push(p.er);
    cells.set(key, c);
  }
  const qualified = [...cells.values()]
    .filter((c) => c.ers.length >= MIN_CELL)
    .map((c) => ({ day: c.day, part: c.part, avg: mean(c.ers) as number, count: c.ers.length }))
    .sort((a, b) => b.avg - a.avg);

  let slots: ScheduleSlot[] = [];
  let basis: PostingSchedule['basis'] = null;

  if (qualified.length >= 2) {
    basis = 'day_time';
    const usedDays = new Set<number>();
    for (const c of qualified) {
      if (slots.length >= 3) break;
      if (usedDays.has(c.day)) continue;   // one slot per day for a spread-out week
      usedDays.add(c.day);
      slots.push({
        day: c.day, day_label: DAY_LABELS[c.day]!, part_key: c.part.key, part_label: c.part.label,
        range: c.part.range, avg_er: c.avg, count: c.count, lift_pct: liftOf(c.avg),
      });
    }
    // Backfill from remaining cells if fewer than 3 distinct days were available.
    if (slots.length < 3) {
      for (const c of qualified) {
        if (slots.length >= 3) break;
        if (slots.some((s) => s.day === c.day && s.part_key === c.part.key)) continue;
        slots.push({
          day: c.day, day_label: DAY_LABELS[c.day]!, part_key: c.part.key, part_label: c.part.label,
          range: c.part.range, avg_er: c.avg, count: c.count, lift_pct: liftOf(c.avg),
        });
      }
    }
  } else {
    // ---- Tier B: time-of-day only (grid too sparse) ----------------------
    basis = 'time_only';
    const byPart = new Map<string, { part: Part; ers: number[] }>();
    for (const p of points) {
      const b = byPart.get(p.meta.part.key) ?? { part: p.meta.part, ers: [] };
      b.ers.push(p.er);
      byPart.set(p.meta.part.key, b);
    }
    slots = [...byPart.values()]
      .filter((b) => b.ers.length >= MIN_CELL)
      .map((b) => ({ part: b.part, avg: mean(b.ers) as number, count: b.ers.length }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3)
      .map((b) => ({
        day: null, day_label: 'Most days', part_key: b.part.key, part_label: b.part.label,
        range: b.part.range, avg_er: b.avg, count: b.count, lift_pct: liftOf(b.avg),
      }));
  }

  if (!slots.length) return empty;

  const best = slots[0]!;
  const headline = basis === 'day_time'
    ? `Your strongest window is ${best.day_label} ${best.part_label.toLowerCase()} (${best.range})${best.lift_pct != null && best.lift_pct > 0 ? ` — ${best.lift_pct}% above your average` : ''}.`
    : `You engage best in the ${best.part_label.toLowerCase()} (${best.range})${best.lift_pct != null && best.lift_pct > 0 ? ` — ${best.lift_pct}% above average` : ''}.`;
  const tip = basis === 'day_time'
    ? `Anchor your week to these slots — line up your best content for ${slots.map((s) => s.day_label).slice(0, 3).join(', ')} and post in those windows.`
    : `Aim your posts at the ${best.part_label.toLowerCase()} window. Post more across different days to unlock a day-specific schedule.`;

  return {
    available: true,
    sample_size: points.length,
    timezone: 'IST',
    basis,
    slots,
    headline,
    tip,
  };
}
