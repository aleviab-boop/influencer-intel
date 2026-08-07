'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface StatementMonth { key: string; label: string; gross: number; deals: number }
interface StatementBrand { brand: string; gross: number; deals: number; pct: number }
interface EarningsStatement {
  available: boolean;
  fy: string;
  fy_label: string;
  fy_start: string;
  fy_end: string;
  prev_fy: string;
  next_fy: string;
  is_current_fy: boolean;
  currency: 'INR';
  gross: number;
  deal_count: number;
  brand_count: number;
  avg_deal: number;
  tds_rate_pct: number;
  tds_estimate: number;
  net_estimate: number;
  receivable: number;
  months: StatementMonth[];
  brands: StatementBrand[];
  headline: string;
  note: string;
}

const money = (n: number): string => (n > 0 ? '₹' + Math.round(n).toLocaleString('en-IN') : '—');

export default function StatementPage() {
  return (
    <Suspense fallback={null}>
      <Statement />
    </Suspense>
  );
}

function Statement() {
  const [handle, setHandle] = useState<string | null>(null);
  const [fy, setFy] = useState<string | null>(null);
  const [data, setData] = useState<EarningsStatement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    setFy(params.get('fy'));
  }, []);

  const load = useCallback((targetFy: string | null) => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (handle) qs.set('handle', handle.replace(/^@/, ''));
    if (targetFy) qs.set('fy', targetFy);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    fetch(`/api/creator/statement${suffix}`)
      .then((r) => r.json())
      .then((d: EarningsStatement) => setData(d))
      .catch(() => setData({ available: false } as EarningsStatement))
      .finally(() => setLoading(false));
  }, [handle]);

  useEffect(() => {
    if (handle === null && fy === null) return;
    load(fy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const go = (f: string): void => { setFy(f); load(f); };
  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator';
  const maxMonth = data ? Math.max(1, ...data.months.map((m) => m.gross)) : 1;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <div className="print:hidden"><MarketingNav /></div>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <div className="print:hidden">
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Back to dashboard
          </Link>

          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-ink-900">Earnings statement</h1>
              {data?.headline && <p className="mt-1.5 text-[14px] text-ink-600">{data.headline}</p>}
            </div>
            {data && (
              <div className="flex items-center gap-1.5">
                <button onClick={() => go(data.prev_fy)} className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-white text-ink-600 hover:border-[#d9d4f5]" aria-label="Previous financial year">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <div className="text-[14px] font-semibold text-ink-800 w-[120px] text-center tabular-nums">{data.fy_label}</div>
                <button onClick={() => go(data.next_fy)} disabled={data.is_current_fy} className="w-9 h-9 grid place-items-center rounded-lg border border-border bg-white text-ink-600 hover:border-[#d9d4f5] disabled:opacity-40 disabled:hover:border-border" aria-label="Next financial year">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <h2 className="text-[16px] font-semibold text-ink-900">Nothing to report yet</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500 max-w-sm mx-auto">Once brands mark your deals as paid, your financial-year earnings will roll up here for tax time.</p>
            <Link href={handle ? `/creator/deals?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator/deals'} className="inline-block mt-5 px-5 py-2.5 text-sm font-semibold text-white rounded-xl" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>View your deals</Link>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {/* Print header (only on paper) */}
            <div className="hidden print:block mb-4">
              <div className="text-lg font-bold text-ink-900">Earnings statement — {data.fy_label}</div>
              <div className="text-[12px] text-ink-500">{data.fy_start} to {data.fy_end}{handle ? ` · @${handle.replace(/^@/, '')}` : ''}</div>
            </div>

            {/* Headline totals */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="Gross earned" value={money(data.gross)} accent />
              <Tile label="Deals paid" value={String(data.deal_count)} sub={`${data.brand_count} brand${data.brand_count === 1 ? '' : 's'}`} />
              <Tile label={`Est. TDS (${data.tds_rate_pct}%)`} value={money(data.tds_estimate)} />
              <Tile label="Net (est.)" value={money(data.net_estimate)} />
            </div>

            {data.receivable > 0 && (
              <div className="rounded-2xl p-4 text-[13px] text-ink-700" style={{ background: ACCENT_SOFT }}>
                <span className="font-semibold" style={{ color: ACCENT }}>Outstanding · </span>
                {money(data.receivable)} in live deals not yet paid — not counted above until the brand settles.
              </div>
            )}

            {/* Monthly breakdown */}
            <section className="rounded-2xl bg-white border border-border shadow-card p-5">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Month by month</h2>
              <div className="space-y-1.5">
                {data.months.map((m) => (
                  <div key={m.key} className="flex items-center gap-3">
                    <div className="w-[68px] text-[12px] text-ink-500 tabular-nums shrink-0">{m.label}</div>
                    <div className="flex-1 h-5 rounded-md bg-[#f4f4f6] overflow-hidden">
                      {m.gross > 0 && (
                        <div className="h-full rounded-md" style={{ width: `${Math.max(4, (m.gross / maxMonth) * 100)}%`, background: `linear-gradient(90deg, ${ACCENT}, #9b7bff)` }} />
                      )}
                    </div>
                    <div className="w-[92px] text-right text-[12.5px] font-semibold text-ink-700 tabular-nums shrink-0">{money(m.gross)}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Per-brand */}
            {data.brands.length > 0 && (
              <section className="rounded-2xl bg-white border border-border shadow-card p-5">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">By brand</h2>
                <div className="divide-y divide-border">
                  {data.brands.map((b) => (
                    <div key={b.brand} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-ink-900 truncate">{b.brand}</div>
                        <div className="text-[12px] text-ink-400">{b.deals} deal{b.deals === 1 ? '' : 's'} · {b.pct}% of FY</div>
                      </div>
                      <div className="text-[14px] font-bold text-ink-800 tabular-nums shrink-0">{money(b.gross)}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* TDS note */}
            <div className="rounded-2xl p-4 text-[12.5px] text-ink-600 bg-[#fffbeb]">
              <span className="font-semibold text-[#d97706]">Note · </span>{data.note}
            </div>

            {/* Print */}
            <div className="print:hidden flex justify-end">
              <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>
                Save as PDF
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-white shadow-card px-4 py-3.5">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 text-[18px] font-bold tabular-nums leading-none" style={accent ? { color: ACCENT } : undefined}>{value}</div>
      {sub && <div className="mt-1 text-[11.5px] text-ink-500">{sub}</div>}
    </div>
  );
}
