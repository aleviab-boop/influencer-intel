'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

type EventState = 'overdue' | 'due' | 'upcoming' | 'done';
interface CalendarEvent {
  deal_id: string;
  program: string;
  brand: string;
  date: string;
  state: EventState;
  rate: number;
}
interface CalendarDay {
  date: string;
  day: number;
  in_month: boolean;
  is_today: boolean;
  events: CalendarEvent[];
}
interface ContentCalendar {
  available: boolean;
  month: string;
  month_label: string;
  prev_month: string;
  next_month: string;
  weeks: CalendarDay[][];
  agenda: CalendarEvent[];
  counts: { this_month: number; overdue: number; upcoming: number };
  headline: string | null;
}

const money = (n: number): string => (n > 0 ? '₹' + n.toLocaleString('en-IN') : '—');
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATE_C: Record<EventState, string> = {
  overdue: '#dc2626',
  due: '#d97706',
  upcoming: ACCENT,
  done: '#16a34a',
};
const STATE_LABEL: Record<EventState, string> = {
  overdue: 'Overdue', due: 'Due today', upcoming: 'Upcoming', done: 'Done',
};

const dateLabel = (s: string): string => {
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <Calendar />
    </Suspense>
  );
}

function Calendar() {
  const [handle, setHandle] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<ContentCalendar | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    setMonth(params.get('month'));
  }, []);

  const load = useCallback((targetMonth: string | null) => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (handle) qs.set('handle', handle.replace(/^@/, ''));
    if (targetMonth) qs.set('month', targetMonth);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    fetch(`/api/creator/calendar${suffix}`)
      .then((r) => r.json())
      .then((d: ContentCalendar) => setData(d))
      .catch(() => setData({ available: false } as ContentCalendar))
      .finally(() => setLoading(false));
  }, [handle]);

  // Load once the handle has been resolved from the URL/localStorage.
  useEffect(() => {
    if (handle === null && month === null) return;
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const go = (m: string): void => { setMonth(m); load(m); };

  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator';
  const dealHref = (id: string): string =>
    `/creator/deals/${encodeURIComponent(id)}${handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : ''}`;

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5 transition-colors duration-200">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Content calendar</h1>
            {data?.headline && <p className="mt-1.5 text-[14px] text-ink-600">{data.headline}</p>}
          </div>
          {data && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => go(data.prev_month)} className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-white text-ink-600 hover:border-[#d9d4f5] transition-colors duration-200" aria-label="Previous month">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <div className="text-[14px] font-semibold text-ink-800 w-[130px] text-center tabular-nums">{data.month_label}</div>
              <button onClick={() => go(data.next_month)} className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-white text-ink-600 hover:border-[#d9d4f5] transition-colors duration-200" aria-label="Next month">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data ? null : (
          <>
            {/* Count chips */}
            <div className="mt-5 flex flex-wrap gap-2">
              <Chip label="This month" value={data.counts.this_month} />
              <Chip label="Overdue" value={data.counts.overdue} c={data.counts.overdue > 0 ? '#dc2626' : undefined} />
              <Chip label="Upcoming" value={data.counts.upcoming} />
            </div>

            {/* Month grid */}
            <div className="mt-5 rounded-2xl border border-border bg-white shadow-card overflow-hidden">
              <div className="grid grid-cols-7 border-b border-border">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 text-center">{w}</div>
                ))}
              </div>
              <div>
                {data.weeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 border-b border-border last:border-b-0">
                    {week.map((cell) => (
                      <div
                        key={cell.date}
                        className={`min-h-[84px] border-r border-border last:border-r-0 p-1.5 ${cell.in_month ? 'bg-white' : 'bg-[#fafafc]'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-[11.5px] tabular-nums grid place-items-center w-5 h-5 rounded-full ${cell.is_today ? 'text-white font-bold' : cell.in_month ? 'text-ink-600' : 'text-ink-300'}`}
                            style={cell.is_today ? { background: ACCENT } : undefined}
                          >
                            {cell.day}
                          </span>
                        </div>
                        <div className="mt-1 space-y-1">
                          {cell.events.slice(0, 3).map((e) => (
                            <Link
                              key={e.deal_id}
                              href={dealHref(e.deal_id)}
                              className="block truncate text-[10.5px] leading-tight px-1.5 py-1 rounded-md font-medium hover:opacity-80"
                              style={{ background: `${STATE_C[e.state]}14`, color: STATE_C[e.state] }}
                              title={`${e.program} · ${e.brand}`}
                            >
                              {e.program}
                            </Link>
                          ))}
                          {cell.events.length > 3 && (
                            <div className="text-[10px] text-ink-400 px-1.5">+{cell.events.length - 3} more</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-3">
              {(['overdue', 'due', 'upcoming', 'done'] as EventState[]).map((st) => (
                <div key={st} className="flex items-center gap-1.5 text-[11.5px] text-ink-500">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATE_C[st] }} />
                  {STATE_LABEL[st]}
                </div>
              ))}
            </div>

            {/* Agenda */}
            <section className="mt-8">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">
                Coming up <span className="text-ink-300">({data.agenda.length})</span>
              </h2>
              {data.agenda.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-white px-5 py-8 text-center text-[13.5px] text-ink-500">
                  Nothing on the horizon. Apply to a campaign to fill your calendar.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data.agenda.map((e) => (
                    <Link
                      key={`${e.deal_id}:${e.date}`}
                      href={dealHref(e.deal_id)}
                      className="group flex items-center gap-3 rounded-xl bg-white border border-border shadow-card px-4 py-3 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]"
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATE_C[e.state] }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold text-ink-900 truncate">{e.program}</div>
                        <div className="text-[12px] text-ink-400 truncate">{e.brand}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[12.5px] font-semibold text-ink-700 tabular-nums">{dateLabel(e.date)}</div>
                        <div className="text-[11.5px]" style={{ color: STATE_C[e.state] }}>{money(e.rate)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Chip({ label, value, c }: { label: string; value: number; c?: string }) {
  return (
    <div className="rounded-full border border-border bg-white px-3.5 py-1.5 text-[12.5px] flex items-center gap-1.5">
      <span className="text-ink-500">{label}</span>
      <span className="font-bold tabular-nums" style={c ? { color: c } : undefined}>{value}</span>
    </div>
  );
}
