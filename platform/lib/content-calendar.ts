// ============================================================
// Content calendar — the deals list answers "what's most urgent", but a creator
// juggling several collabs also needs to SEE the month: which days are heavy,
// where the gaps are, what's slipping. This lays the same deal deadlines onto a
// calendar grid plus a forward agenda, so planning content is spatial instead
// of a scroll through cards.
//
// Pure and deterministic: it buckets the deal rows the route fetched onto the
// days of a target month — no ML/LLM, no writes. Both "today" and the target
// month are injected so month navigation and the "today" marker are testable
// and timezone-honest.
// ============================================================

export interface CalendarDealInput {
  id: string;
  program: string;
  brand: string;
  rate: number;
  paid: boolean;
  status: string;
  due_date: string | null;   // YYYY-MM-DD
}

export type EventState = 'overdue' | 'due' | 'upcoming' | 'done';

export interface CalendarEvent {
  deal_id: string;
  program: string;
  brand: string;
  date: string;              // YYYY-MM-DD
  state: EventState;
  rate: number;
}

export interface CalendarDay {
  date: string;              // YYYY-MM-DD
  day: number;               // 1..31
  in_month: boolean;
  is_today: boolean;
  events: CalendarEvent[];
}

export interface ContentCalendar {
  available: boolean;
  month: string;             // YYYY-MM
  month_label: string;       // "August 2026"
  prev_month: string;        // YYYY-MM
  next_month: string;        // YYYY-MM
  weeks: CalendarDay[][];    // rows of 7 (Mon..Sun)
  agenda: CalendarEvent[];   // undone events from today forward, soonest first
  counts: { this_month: number; overdue: number; upcoming: number };
  headline: string | null;
}

const LIVE_STATUSES = new Set(['recruited', 'contacted', 'active', 'accepted', 'invited']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (y: number, m0: number, d: number): string => `${y}-${pad(m0 + 1)}-${pad(d)}`;

function shiftMonth(month: string, delta: number): string {
  const parts = month.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = new Date(Date.UTC(y, (m - 1) + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// Monday-first weekday index (0=Mon..6=Sun).
function mondayIdx(y: number, m0: number, d: number): number {
  return (new Date(Date.UTC(y, m0, d)).getUTCDay() + 6) % 7;
}

export function buildContentCalendar(
  deals: CalendarDealInput[],
  monthISO: string,   // YYYY-MM
  todayISO: string,   // YYYY-MM-DD or ISO
): ContentCalendar {
  const today = todayISO.slice(0, 10);
  const month = /^\d{4}-\d{2}$/.test(monthISO) ? monthISO : today.slice(0, 7);
  const parts = month.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const m0 = m - 1;
  const monthLabel = `${MONTHS[m0]} ${y}`;

  // Deals that are real (live/paid/priced) and have a due date → an event.
  const events: CalendarEvent[] = [];
  for (const d of deals) {
    if (!d.due_date) continue;
    const isDeal = LIVE_STATUSES.has((d.status ?? '').toLowerCase()) || d.paid || Number(d.rate) > 0;
    if (!isDeal) continue;
    const state: EventState = d.paid
      ? 'done'
      : d.due_date < today ? 'overdue'
      : d.due_date === today ? 'due'
      : 'upcoming';
    events.push({ deal_id: d.id, program: d.program, brand: d.brand, date: d.due_date, state, rate: Number(d.rate) || 0 });
  }

  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }

  // Build a Mon-first grid covering the whole month (leading/trailing spill days).
  const daysInMonth = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const lead = mondayIdx(y, m0, 1);
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const weeks: CalendarDay[][] = [];
  let week: CalendarDay[] = [];
  for (let cell = 0; cell < totalCells; cell++) {
    const dayNum = cell - lead + 1;             // 1-based day in target month
    const dt = new Date(Date.UTC(y, m0, dayNum)); // JS normalises spill into prev/next
    const cy = dt.getUTCFullYear(), cm0 = dt.getUTCMonth(), cd = dt.getUTCDate();
    const date = ymd(cy, cm0, cd);
    week.push({
      date,
      day: cd,
      in_month: cm0 === m0 && cy === y,
      is_today: date === today,
      events: byDate.get(date) ?? [],
    });
    if (week.length === 7) { weeks.push(week); week = []; }
  }

  // Agenda: undone events today-forward, soonest first.
  const agenda = events
    .filter((e) => e.state !== 'done' && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const thisMonthCount = events.filter((e) => e.date.slice(0, 7) === month).length;
  const overdue = events.filter((e) => e.state === 'overdue').length;
  const upcoming = agenda.length;

  const headline = overdue > 0
    ? `${overdue} deliverable${overdue === 1 ? '' : 's'} overdue — clear those first.`
    : upcoming > 0
      ? `${upcoming} deliverable${upcoming === 1 ? '' : 's'} coming up.`
      : thisMonthCount > 0
        ? 'All deliverables this month are done.'
        : 'Nothing scheduled — apply to a campaign to fill your calendar.';

  return {
    available: events.length > 0,
    month, month_label: monthLabel,
    prev_month: shiftMonth(month, -1),
    next_month: shiftMonth(month, 1),
    weeks, agenda,
    counts: { this_month: thisMonthCount, overdue, upcoming },
    headline,
  };
}
