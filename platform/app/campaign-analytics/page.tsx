'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, Reveal, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Totals { campaigns: number; creators: number; reach: number; spend: number; avg_quality: number }
interface Perf { id: string; name: string; status: string; recruits: number; reach: number; spend: number }
interface Outcome { id: string; name: string | null; handle: string | null; predicted_likes: number | null; actual_likes: number | null; predicted_views: number | null; actual_views: number | null }

const n = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v) || 0);
const k = (v: number): string => (v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v)));
const inr = (v: number): string => '₹' + k(v);

type Period = '7d' | '30d' | '90d' | 'all';
const PERIOD_LABEL: Record<Period, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' };
const STATUS_C: Record<string, string> = { active: '#10b981', paused: '#f59e0b', closed: '#94a3b8' };

export default function CampaignAnalyticsPage() {
  const [data, setData] = useState<{ totals: Totals; per_campaign: Perf[]; outcomes: Outcome[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('all');
  const [metric, setMetric] = useState<'likes' | 'views'>('likes');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics?period=${period}`).then((r) => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { setMounted(false); const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t); }, [metric, data]);

  const pick = (o: Outcome) => metric === 'likes'
    ? { p: n(o.predicted_likes), a: n(o.actual_likes), ok: o.predicted_likes != null && o.actual_likes != null }
    : { p: n(o.predicted_views), a: n(o.actual_views), ok: o.predicted_views != null && o.actual_views != null };
  const rows = (data?.outcomes ?? []).map((o) => ({ o, ...pick(o) })).filter((r) => r.ok).slice(0, 10);
  const accuracy = rows.length ? Math.round(100 - (rows.reduce((s, r) => s + Math.abs(r.p - r.a) / Math.max(1, r.p), 0) / rows.length) * 100) : null;
  const maxV = Math.max(1, ...rows.flatMap((r) => [r.p, r.a]));
  const t = data?.totals;

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
            <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Campaign Analytics</span>
            <Reveal><h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-tight">Predicted vs. real campaign analytics</h1></Reveal>
            <p className="mt-3 text-[15px] text-ink-600 max-w-xl mx-auto">Live numbers from your campaigns — forecast a post’s likes and views, then measure the gap against real results.</p>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-8">
          {/* period */}
          <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
            <div className="flex gap-1 p-1 rounded-lg bg-white border border-border">
              {(['7d', '30d', '90d', 'all'] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-md text-[13px] transition-colors ${period === p ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'}`}>{PERIOD_LABEL[p]}</button>
              ))}
            </div>
            <Link href="/analytics" className="text-[13px] font-semibold" style={{ color: ACCENT }}>Open full dashboard →</Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
          ) : !data ? (
            <div className="text-sm text-rose-700">Failed to load analytics.</div>
          ) : (
            <>
              {/* live stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <Stat label="Campaigns" value={String(t!.campaigns)} />
                <Stat label="Creators" value={String(t!.creators)} />
                <Stat label="Total reach" value={k(n(t!.reach))} accent />
                <Stat label="Spend" value={inr(n(t!.spend))} />
                <Stat label="Forecast accuracy" value={accuracy != null ? `${accuracy}%` : '—'} />
              </div>

              {/* predicted vs actual chart */}
              <div className="rounded-2xl bg-white border border-border shadow-card p-5 mb-6">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div className="text-[14px] font-bold text-ink-900">Predicted vs. actual {metric}</div>
                  <div className="flex gap-0.5 p-0.5 rounded-lg bg-[#f1f0f7] border border-border">
                    {(['likes', 'views'] as const).map((m) => (
                      <button key={m} onClick={() => setMetric(m)} className={`px-3 py-1 rounded-md text-[12px] font-medium capitalize transition-colors ${metric === m ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>{m}</button>
                    ))}
                  </div>
                </div>
                {rows.length === 0 ? (
                  <div className="text-sm text-ink-400 py-12 text-center rounded-xl border border-dashed border-border">No {metric} results recorded yet. Log post results from the <Link href="/analytics" className="text-ink-900 underline">full dashboard</Link>.</div>
                ) : (
                  <>
                    <div className="flex items-end gap-3 h-40 px-1 border-b border-border-soft">
                      {rows.map((r, i) => (
                        <div key={r.o.id} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                          <div className="w-full flex items-end justify-center gap-1 h-32">
                            <div className="w-1/2 max-w-[16px] rounded-t" style={{ height: mounted ? `${(r.p / maxV) * 100}%` : '0%', background: '#cdbcff', transition: 'height .7s cubic-bezier(.22,.61,.36,1)', transitionDelay: `${i * 45}ms` }} title={`predicted ${k(r.p)}`} />
                            <div className="w-1/2 max-w-[16px] rounded-t" style={{ height: mounted ? `${(r.a / maxV) * 100}%` : '0%', background: ACCENT, transition: 'height .7s cubic-bezier(.22,.61,.36,1)', transitionDelay: `${i * 45 + 90}ms` }} title={`actual ${k(r.a)}`} />
                          </div>
                          <div className="text-[10px] text-ink-400 truncate w-full text-center">{(r.o.name ?? r.o.handle ?? '').replace('@', '').slice(0, 7)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-4 text-[12px] text-ink-600"><Legend c="#cdbcff" label="Predicted" /><Legend c={ACCENT} label="Actual" /></div>
                  </>
                )}
              </div>

              {/* live campaigns */}
              <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
                <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-ink-400 border-b border-border">
                  <span>Campaign</span><span>Creators</span><span>Reach</span><span>Spend</span><span>Status</span>
                </div>
                {data.per_campaign.map((p) => (
                  <Link key={p.id} href={`/campaigns/${p.id}`} className="grid grid-cols-[1.6fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 items-center border-b border-border-soft last:border-0 text-[13px] hover:bg-[#faf9ff]">
                    <span className="font-medium text-ink-900 truncate">{p.name}</span>
                    <span className="tabular-nums text-ink-700">{p.recruits}</span>
                    <span className="tabular-nums text-ink-700">{k(n(p.reach))}</span>
                    <span className="tabular-nums text-ink-700">{inr(n(p.spend))}</span>
                    <span className="text-[12px] font-medium capitalize" style={{ color: STATUS_C[p.status] ?? '#94a3b8' }}>{p.status}</span>
                  </Link>
                ))}
                {data.per_campaign.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-400">No campaigns in this period.</div>}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#6C4DF6]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
function Legend({ c, label }: { c: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: c }} />{label}</span>;
}
