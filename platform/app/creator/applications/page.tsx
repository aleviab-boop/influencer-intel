'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

type Outcome = 'pending' | 'advanced' | 'accepted' | 'closed';
interface ApplicationView {
  program_id: string;
  program: string;
  brand: string;
  status: string;
  outcome: Outcome;
  stage_label: string;
  detail: string;
  target: 'campaign' | 'deals';
  cta_label: string;
  when: string;
  when_label: string;
}
interface ApplicationTracker {
  available: boolean;
  total: number;
  counts: { pending: number; advanced: number; accepted: number; closed: number };
  items: ApplicationView[];
  headline: string;
}

const OUTCOME_C: Record<Outcome, { c: string; b: string }> = {
  advanced: { c: '#d97706', b: '#fffbeb' },
  pending: { c: ACCENT, b: ACCENT_SOFT },
  accepted: { c: '#16a34a', b: '#ecfdf3' },
  closed: { c: '#6b7280', b: '#f3f4f6' },
};

export default function ApplicationsPage() {
  return (
    <Suspense fallback={null}>
      <Applications />
    </Suspense>
  );
}

function Applications() {
  const [handle, setHandle] = useState<string | null>(null);
  const [data, setData] = useState<ApplicationTracker | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    const qs = h ? `?handle=${encodeURIComponent(h.replace(/^@/, ''))}` : '';
    fetch(`/api/creator/application-tracker${qs}`)
      .then((r) => r.json())
      .then((d: ApplicationTracker) => setData(d))
      .catch(() => setData({ available: false } as ApplicationTracker))
      .finally(() => setLoading(false));
  }, []);

  const hq = handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '';
  const backHref = handle ? `/creator${hq}` : '/creator';
  const hrefFor = (a: ApplicationView): string =>
    a.target === 'deals' ? `/creator/deals${hq}` : `/creator/campaigns/${encodeURIComponent(a.program_id)}`;

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5 transition-colors duration-200">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ink-900">Your applications</h1>
        {data?.headline && <p className="mt-1.5 text-[14px] text-ink-600">{data.headline}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
            </div>
            <h2 className="text-[16px] font-semibold text-ink-900">No applications yet</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500 max-w-sm mx-auto">When you apply to an open campaign, it\u2019ll appear here so you can track whether the brand has responded.</p>
            <Link href={backHref} className="inline-block mt-5 px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>Browse open campaigns</Link>
          </div>
        ) : (
          <>
            {/* Count chips */}
            <div className="mt-5 flex flex-wrap gap-2">
              <Chip label="Awaiting review" value={data.counts.pending} c={OUTCOME_C.pending.c} />
              <Chip label="Brand responded" value={data.counts.advanced} c={OUTCOME_C.advanced.c} />
              <Chip label="Turned into deals" value={data.counts.accepted} c={OUTCOME_C.accepted.c} />
              <Chip label="Closed" value={data.counts.closed} c={OUTCOME_C.closed.c} />
            </div>

            {/* List */}
            <div className="mt-6 space-y-3">
              {data.items.map((a) => {
                const oc = OUTCOME_C[a.outcome];
                return (
                  <Link key={a.program_id} href={hrefFor(a)} className="group block rounded-2xl bg-white border border-border shadow-card p-5 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-ink-900 truncate">{a.program}</div>
                        <div className="text-[12.5px] text-ink-400 truncate">{a.brand}</div>
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ color: oc.c, background: oc.b }}>{a.stage_label}</span>
                    </div>
                    <p className="mt-2.5 text-[13px] text-ink-600">{a.detail}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[11.5px] text-ink-400">Applied {a.when_label}</span>
                      <span className="text-[12.5px] font-semibold inline-flex items-center gap-1" style={{ color: oc.c }}>
                        {a.cta_label}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Chip({ label, value, c }: { label: string; value: number; c: string }) {
  return (
    <div className="rounded-full border border-border bg-white px-3.5 py-1.5 text-[12.5px] flex items-center gap-1.5">
      <span className="text-ink-500">{label}</span>
      <span className="font-bold tabular-nums" style={value > 0 ? { color: c } : undefined}>{value}</span>
    </div>
  );
}
