'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface DealView {
  id: string;
  brand: string;
  program: string;
  rate: number;
  deliverables: string[];
  due_date: string | null;
  days_to_due: number | null;
  urgency: 'overdue' | 'due-soon' | 'scheduled' | 'none';
  stage: 'in_progress' | 'awaiting_payment' | 'paid';
  stage_label: string;
  paid: boolean;
  paid_at: string | null;
  next_action: string;
}
interface Workspace {
  available: boolean;
  reason?: string;
  currency: 'INR';
  summary: {
    active_count: number;
    awaiting_payment_count: number;
    paid_count: number;
    total_earned: number;
    pending: number;
    lifetime: number;
    next_due: string | null;
    overdue_count: number;
  };
  groups: { key: string; label: string; deals: DealView[] }[];
  headline: string | null;
}

const money = (n: number): string => (n > 0 ? '₹' + n.toLocaleString('en-IN') : '—');
const dateStr = (s: string | null): string => {
  if (!s) return '—';
  const d = new Date(s + (s.length <= 10 ? 'T00:00:00Z' : ''));
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const URGENCY: Record<DealView['urgency'], { label: string; c: string; b: string } | null> = {
  overdue: { label: 'Overdue', c: '#dc2626', b: '#fef2f2' },
  'due-soon': { label: 'Due soon', c: '#d97706', b: '#fffbeb' },
  scheduled: null,
  none: null,
};
const STAGE_C: Record<DealView['stage'], string> = {
  in_progress: ACCENT,
  awaiting_payment: '#d97706',
  paid: '#16a34a',
};

export default function DealsPage() {
  return (
    <Suspense fallback={null}>
      <Deals />
    </Suspense>
  );
}

function Deals() {
  const [handle, setHandle] = useState<string | null>(null);
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    const qs = h ? `?handle=${encodeURIComponent(h.replace(/^@/, ''))}` : '';
    fetch(`/api/creator/deals${qs}`)
      .then((r) => r.json())
      .then((d: Workspace) => setData(d))
      .catch(() => setData({ available: false, reason: 'error' } as Workspace))
      .finally(() => setLoading(false));
  }, []);

  const s = data?.summary;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <Link href={handle ? `/creator?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator'} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ink-900">Your deals</h1>
        {data?.headline && <p className="mt-1.5 text-[14px] text-ink-600">{data.headline}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7H4M20 7l-2 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L4 7M9 7V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3" /></svg>
            </div>
            <h2 className="text-[16px] font-semibold text-ink-900">No deals yet</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500 max-w-sm mx-auto">Once a brand recruits you from a campaign, your deliverables, deadlines and payments will live here.</p>
            <Link href="/creator" className="inline-block mt-5 px-5 py-2.5 text-sm font-semibold text-white rounded-xl" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>Browse open campaigns</Link>
          </div>
        ) : (
          <>
            {/* Summary */}
            {s && (
              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryTile label="In progress" value={String(s.active_count)} sub={s.overdue_count > 0 ? `${s.overdue_count} overdue` : 'on track'} accent={s.overdue_count > 0} />
                <SummaryTile label="Awaiting payment" value={String(s.awaiting_payment_count)} sub={money(s.pending) + ' pending'} />
                <SummaryTile label="Earned" value={money(s.total_earned)} sub={`${s.paid_count} paid`} href={handle ? `/creator/goal?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator/goal'} />
                <SummaryTile label="Next deadline" value={s.next_due ? dateStr(s.next_due) : '—'} sub={s.next_due ? 'upcoming' : 'nothing due'} />
              </div>
            )}

            {/* Groups */}
            <div className="mt-8 space-y-8">
              {data.groups.map((g) => (
                <section key={g.key}>
                  <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">
                    {g.label} <span className="text-ink-300">({g.deals.length})</span>
                  </h2>
                  <div className="space-y-3">
                    {g.deals.map((d) => (
                      <DealCard key={d.id} d={d} handle={handle} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SummaryTile({ label, value, sub, accent, href }: { label: string; value: string; sub: string; accent?: boolean; href?: string }) {
  const inner = (
    <>
      <div className="text-[10.5px] uppercase tracking-wider text-ink-400 flex items-center gap-1">
        {label}
        {href && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-300"><path d="M9 18l6-6-6-6" /></svg>}
      </div>
      <div className="mt-1 text-[20px] font-bold tabular-nums leading-none" style={accent ? { color: '#dc2626' } : undefined}>{value}</div>
      <div className="mt-1 text-[11.5px] text-ink-500">{sub}</div>
    </>
  );
  const cls = 'rounded-2xl border border-border bg-white shadow-card px-4 py-3.5';
  return href
    ? <Link href={href} className={`${cls} block hover:border-[#d9d4f5] transition-colors`}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}

function DealCard({ d, handle }: { d: DealView; handle: string | null }) {
  const u = URGENCY[d.urgency];
  const stageC = STAGE_C[d.stage];
  const href = `/creator/deals/${encodeURIComponent(d.id)}${handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : ''}`;
  return (
    <Link href={href} className="block rounded-2xl bg-white border border-border shadow-card p-5 hover:border-[#d9d4f5] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink-900 truncate">{d.program}</div>
          <div className="text-[12.5px] text-ink-400 truncate">{d.brand}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {u && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: u.c, background: u.b }}>{u.label}</span>
          )}
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: stageC, background: `${stageC}14` }}>{d.stage_label}</span>
        </div>
      </div>

      {/* Rate + due */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="px-2 py-1 rounded-md font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>{money(d.rate)}</span>
        {d.due_date && (
          <span className="px-2 py-1 rounded-md bg-[#f4f4f6] text-ink-600">
            Due {dateStr(d.due_date)}
            {d.days_to_due != null && d.stage === 'in_progress' && (
              <span className="text-ink-400">
                {d.days_to_due < 0 ? ` · ${Math.abs(d.days_to_due)}d ago` : d.days_to_due === 0 ? ' · today' : ` · in ${d.days_to_due}d`}
              </span>
            )}
          </span>
        )}
        {d.paid && d.paid_at && (
          <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700">Paid {dateStr(d.paid_at.slice(0, 10))}</span>
        )}
      </div>

      {/* Deliverables checklist */}
      {d.deliverables.length > 0 && (
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-400 mb-1.5">Deliverables</div>
          <ul className="space-y-1">
            {d.deliverables.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] text-ink-700">
                <span className="mt-0.5 w-4 h-4 shrink-0 rounded-[5px] border-2" style={{ borderColor: d.paid ? '#16a34a' : '#d6d3e8', background: d.paid ? '#16a34a' : 'transparent' }} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next action */}
      <div className="mt-3 rounded-lg px-3 py-2.5 text-[12.5px] text-ink-700" style={{ background: d.urgency === 'overdue' ? '#fef2f2' : ACCENT_SOFT }}>
        <span className="font-semibold" style={{ color: d.urgency === 'overdue' ? '#dc2626' : ACCENT }}>Next · </span>
        {d.next_action}
      </div>
    </Link>
  );
}
