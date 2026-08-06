// ============================================================
// Format × timing matrix — "post THIS format in THIS window".
//
// The best-format signal and the best-time signal each answer half the
// question. This crosses them: for every content format we hold, which
// posting window earns the most engagement? The result is a small grid the
// creator can read at a glance, plus a single headline "best bet".
//
// With only ~24 recent posts a full format×day×hour cube would be far too
// sparse to trust, so we collapse time into the same coarse IST day-parts the
// posting-time analysis uses (early/morning/…/late night). Cells are only
// crowned a "best" once they clear a minimum sample. Pure — computed from the
// posts the analytics route already fetched. Everything is directional.
// ============================================================

export interface MatrixPost {
  media_type: string;   // IG media type (VIDEO/REELS/CAROUSEL_ALBUM/IMAGE…)
  timestamp: string;    // ISO, UTC
  er: number | null;
}

export type FormatKey = 'reels' | 'carousels' | 'photos';

export interface MatrixCell {
  format: FormatKey;
  part_key: string;
  count: number;
  avg_er: number | null;
}

export interface FormatRow {
  format: FormatKey;
  label: string;
  count: number;
  cells: MatrixCell[];                 // one per part, column order
  best: { part_key: string; part_label: string; range: string; avg_er: number; count: number } | null;
}

export interface FormatTimingMatrix {
  available: boolean;
  sample_size: number;
  timezone: 'IST';
  parts: { key: string; label: string; range: string }[];   // column headers
  rows: FormatRow[];                                         // only formats we hold
  best_bet: {
    format: FormatKey; format_label: string;
    part_key: string; part_label: string; range: string;
    avg_er: number; count: number;
  } | null;
  headline: string | null;
}

const FORMAT_LABEL: Record<FormatKey, string> = { reels: 'Reels', carousels: 'Carousels', photos: 'Photos' };
const FORMAT_SINGULAR: Record<FormatKey, string> = { reels: 'Reel', carousels: 'Carousel', photos: 'photo' };

// Same coarse IST windows as the posting-time analysis, kept local so this
// module stands alone.
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

function istHour(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + IST_OFFSET_MIN * 60_000).getUTCHours();
}

function partKeyFor(hour: number): string {
  for (const p of PARTS) {
    if (p.from < p.to) { if (hour >= p.from && hour < p.to) return p.key; }
    else if (hour >= p.from || hour < p.to) return p.key; // wraps midnight
  }
  return PARTS[PARTS.length - 1]!.key;
}

function formatKey(mediaType: string): FormatKey {
  if (mediaType === 'VIDEO' || mediaType === 'REELS') return 'reels';
  if (mediaType === 'CAROUSEL_ALBUM') return 'carousels';
  return 'photos';
}

/** Minimum posts in a cell before we'll crown it a "best". */
const MIN_CELL = 2;
const MIN_SAMPLE = 6;

export function analyzeFormatTiming(posts: MatrixPost[]): FormatTimingMatrix {
  const usable = posts
    .map((p) => ({ format: formatKey(p.media_type), hour: istHour(p.timestamp), er: p.er }))
    .filter((p): p is { format: FormatKey; hour: number; er: number } =>
      p.hour != null && p.er != null && p.er > 0)
    .map((p) => ({ format: p.format, part: partKeyFor(p.hour), er: p.er }));

  const parts = PARTS.map((p) => ({ key: p.key, label: p.label, range: p.range }));
  const empty: FormatTimingMatrix = {
    available: false, sample_size: usable.length, timezone: 'IST',
    parts, rows: [], best_bet: null, headline: null,
  };
  if (usable.length < MIN_SAMPLE) return empty;

  // Which formats do we actually hold? (Keep the grid free of empty rows.)
  const presentFormats = (['reels', 'carousels', 'photos'] as FormatKey[])
    .filter((f) => usable.some((p) => p.format === f));

  const rows: FormatRow[] = presentFormats.map((format) => {
    const inFormat = usable.filter((p) => p.format === format);
    const cells: MatrixCell[] = PARTS.map((part) => {
      const g = inFormat.filter((p) => p.part === part.key);
      return { format, part_key: part.key, count: g.length, avg_er: mean(g.map((x) => x.er)) };
    });

    // Best window for THIS format (needs the minimum sample).
    let best: FormatRow['best'] = null;
    for (const c of cells) {
      if (c.count >= MIN_CELL && c.avg_er != null && (best == null || c.avg_er > best.avg_er)) {
        const meta = PARTS.find((p) => p.key === c.part_key)!;
        best = { part_key: c.part_key, part_label: meta.label, range: meta.range, avg_er: c.avg_er, count: c.count };
      }
    }

    return { format, label: FORMAT_LABEL[format], count: inFormat.length, cells, best };
  });

  // Single best bet across the whole grid.
  let best_bet: FormatTimingMatrix['best_bet'] = null;
  for (const row of rows) {
    if (row.best && (best_bet == null || row.best.avg_er > best_bet.avg_er)) {
      best_bet = {
        format: row.format, format_label: FORMAT_LABEL[row.format],
        part_key: row.best.part_key, part_label: row.best.part_label, range: row.best.range,
        avg_er: row.best.avg_er, count: row.best.count,
      };
    }
  }

  const headline = best_bet
    ? `Your best bet: a ${FORMAT_SINGULAR[best_bet.format]} in the ${best_bet.part_label.toLowerCase()} window (${best_bet.range} IST) — that combo averages ${(best_bet.avg_er * 100).toFixed(1)}% engagement.`
    : null;

  return { available: true, sample_size: usable.length, timezone: 'IST', parts, rows, best_bet, headline };
}
