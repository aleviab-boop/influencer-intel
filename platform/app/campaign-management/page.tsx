'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Program { id: string; name: string; status: string; recruit_count: number; recruited_count: number; budget: number | string | null; spent: number | string | null }
const n = (v: number | string | null): number => (v == null ? 0 : Number(v) || 0);
const inr = (v: number): string => '₹' + (v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v)));
const STATUS_C: Record<string, string> = { active: '#10b981', paused: '#f59e0b', closed: '#94a3b8' };

export default function CampaignManagementFeature() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/programs').then((r) => r.json()).then((d) => setPrograms(d.programs ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const active = programs.filter((p) => p.status === 'active').length;
  const recruited = programs.reduce((s, p) => s + p.recruit_count, 0);
  const spend = programs.reduce((s, p) => s + n(p.spent), 0);

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
            <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Campaign Management</span>
            <h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-tight">Run every campaign in one place</h1>
            <p className="mt-3 text-[15px] text-ink-600 max-w-xl mx-auto">Recruit creators, move them through a pipeline, set deals and track budget — live across all your campaigns.</p>
            <Link href="/campaigns" className="inline-block mt-6 px-6 py-3 rounded-xl text-white text-[15px] font-semibold bg-ink-900 hover:bg-ink-800">Open campaigns</Link>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-10">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="w-9 h-9 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <Stat label="Campaigns" value={String(programs.length)} sub={`${active} active`} />
                <Stat label="Creators recruited" value={String(recruited)} />
                <Stat label="Committed spend" value={inr(spend)} accent />
                <Stat label="Active now" value={String(active)} />
              </div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[15px] font-bold text-ink-900">Your campaigns</h2>
                <Link href="/campaigns" className="text-[13px] font-semibold" style={{ color: ACCENT }}>Manage all →</Link>
              </div>
              <div className="space-y-2.5">
                {programs.slice(0, 6).map((p) => {
                  const budget = n(p.budget), spent = n(p.spent), pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                  return (
                    <Link key={p.id} href={`/campaigns/${p.id}`} className="flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-white border border-border shadow-card hover:border-[#6C4DF6]/40 hover:shadow-hover transition-all">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-ink-900 truncate">{p.name}</span>
                          <span className="text-[11px] font-medium capitalize" style={{ color: STATUS_C[p.status] ?? '#94a3b8' }}>● {p.status}</span>
                        </div>
                        <div className="text-[12px] text-ink-400 mt-0.5">{p.recruit_count} creators · {p.recruited_count} confirmed</div>
                      </div>
                      <div className="hidden sm:block w-40 shrink-0">
                        <div className="flex justify-between text-[12px] mb-1"><span className="text-ink-700 font-medium">{inr(spent)}</span><span className="text-ink-400">{budget > 0 ? `of ${inr(budget)}` : 'no budget'}</span></div>
                        <div className="h-1.5 rounded-full bg-[#eef] overflow-hidden"><div className="h-1.5 rounded-full" style={{ width: `${budget > 0 ? pct : 0}%`, background: 'linear-gradient(90deg,#6C4DF6,#9b7bff)' }} /></div>
                      </div>
                    </Link>
                  );
                })}
                {programs.length === 0 && <div className="text-sm text-ink-400 py-10 text-center rounded-2xl border border-dashed border-border">No campaigns yet. <Link href="/campaigns" className="text-ink-900 underline">Create one</Link>.</div>}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#6C4DF6]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}{sub && <span className="ml-1.5 normal-case tracking-normal text-emerald-600">· {sub}</span>}</div>
    </div>
  );
}
