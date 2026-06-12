'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Payout { program_id: string; creator_id: string; program_name: string; handle: string; display_name: string | null; rate: number | string | null; paid: boolean }
const n = (v: number | string | null): number => (v == null ? 0 : Number(v) || 0);
const inr = (v: number): string => '₹' + Math.round(v).toLocaleString('en-IN');

export default function InfluencerPayoutsFeature() {
  const [rows, setRows] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/payouts').then((r) => r.json()).then((d) => setRows(d.payouts ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const committed = rows.reduce((s, r) => s + n(r.rate), 0);
  const paid = rows.filter((r) => r.paid).reduce((s, r) => s + n(r.rate), 0);
  const pending = committed - paid;

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
            <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Influencer Payouts</span>
            <h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-tight">Pay creators, tracked end to end</h1>
            <p className="mt-3 text-[15px] text-ink-600 max-w-xl mx-auto">Every agreed rate, what’s paid and what’s pending — pay by UPI in a click and keep a clean record.</p>
            <Link href="/payouts" className="inline-block mt-6 px-6 py-3 rounded-xl text-white text-[15px] font-semibold bg-ink-900 hover:bg-ink-800">Open payouts</Link>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-10">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="w-9 h-9 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <Stat label="Committed" value={inr(committed)} />
                <Stat label="Paid" value={inr(paid)} tone="green" />
                <Stat label="Pending" value={inr(pending)} accent />
                <Stat label="Creators" value={String(rows.length)} />
              </div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[15px] font-bold text-ink-900">Recent payouts</h2>
                <Link href="/payouts" className="text-[13px] font-semibold" style={{ color: ACCENT }}>Manage all →</Link>
              </div>
              <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
                <div className="hidden sm:grid grid-cols-[1.4fr_1.2fr_0.8fr_0.6fr] px-4 py-2.5 bg-[#f7f7fb] text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
                  <span>Creator</span><span>Campaign</span><span className="text-right">Rate</span><span className="text-right">Status</span>
                </div>
                {rows.slice(0, 8).map((r) => (
                  <div key={`${r.program_id}-${r.creator_id}`} className="grid grid-cols-2 sm:grid-cols-[1.4fr_1.2fr_0.8fr_0.6fr] gap-y-1 px-4 py-3 items-center border-t border-border-soft text-[13px]">
                    <span className="font-medium text-ink-900 truncate col-span-2 sm:col-span-1">{r.display_name || `@${r.handle}`}</span>
                    <span className="text-ink-600 truncate">{r.program_name}</span>
                    <span className="text-ink-800 tabular-nums sm:text-right font-medium">{r.rate != null ? inr(n(r.rate)) : '—'}</span>
                    <span className="sm:text-right">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: r.paid ? '#ecfdf5' : '#f1f0f7', color: r.paid ? '#047857' : '#6b7280' }}>{r.paid ? 'Paid' : 'Pending'}</span>
                    </span>
                  </div>
                ))}
                {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-400">No payouts yet. Set creator rates on a campaign to populate this.</div>}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: 'green' }) {
  const color = tone === 'green' ? 'text-emerald-700' : accent ? 'text-[#6C4DF6]' : 'text-ink-900';
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
