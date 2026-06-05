'use client';

import { useEffect, useState } from 'react';
import { MarketingNav, ACCENT } from '@/components/marketing';

interface Totals { campaigns: number; creators: number; reach: number; spend: number; avg_quality: number }
interface Perf { id: string; name: string; status: string; recruits: number; reach: number; spend: number }
interface Outcome { id: string; name: string | null; handle: string | null; predicted_likes: number | null; actual_likes: number | null; predicted_views: number | null; actual_views: number | null; created_at: string }

const n = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v) || 0);
const k = (v: number): string => (v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v)));
const inr = (v: number): string => '₹' + k(v);

type Period = '7d' | '30d' | '90d' | 'all';
const PERIOD_LABEL: Record<Period, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' };

export default function AnalyticsPage() {
  const [data, setData] = useState<{ totals: Totals; per_campaign: Perf[]; outcomes: Outcome[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('all');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics?period=${period}`).then((r) => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

  const outs = (data?.outcomes ?? []).filter((o) => o.predicted_likes != null && o.actual_likes != null);
  const accuracy = outs.length
    ? Math.round(100 - (outs.reduce((s, o) => s + Math.abs(n(o.predicted_likes) - n(o.actual_likes)) / Math.max(1, n(o.predicted_likes)), 0) / outs.length) * 100)
    : null;
  const maxLikes = Math.max(1, ...outs.flatMap((o) => [n(o.predicted_likes), n(o.actual_likes)]));

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Campaign Analytics</div>
            <h1 className="text-2xl font-bold text-ink-900">Performance dashboard</h1>
          </div>
          <div className="flex gap-1 p-1 rounded-lg bg-white border border-border">
            {(['7d', '30d', '90d', 'all'] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-md text-[13px] ${period === p ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'}`}>{PERIOD_LABEL[p]}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#FBE3DA] border-t-[#F2542D] animate-spin" /></div>
        ) : !data ? (
          <div className="text-sm text-rose-700">Failed to load analytics.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Stat label="Campaigns" value={String(data.totals.campaigns)} />
              <Stat label="Creators" value={String(data.totals.creators)} />
              <Stat label="Total reach" value={k(n(data.totals.reach))} accent />
              <Stat label="Spend" value={inr(n(data.totals.spend))} />
              <Stat label="Avg quality" value={data.totals.avg_quality ? String(Math.round(n(data.totals.avg_quality))) : '—'} />
            </div>

            {/* predicted vs real */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[13px] font-semibold text-ink-900">Predicted vs. real performance</div>
                  <div className="text-[12px] text-ink-400">Likes per recorded post</div>
                </div>
                {accuracy != null && (
                  <div className="text-right">
                    <div className="text-2xl font-bold tabular-nums" style={{ color: ACCENT }}>{accuracy}%</div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-400">accuracy</div>
                  </div>
                )}
              </div>
              {outs.length === 0 ? (
                <div className="text-sm text-ink-400 py-10 text-center">No recorded outcomes yet. Log post results in <a href="/monitor" className="text-ink-900 underline">Monitor</a>.</div>
              ) : (
                <>
                  <div className="flex items-end gap-4 h-44 px-2">
                    {outs.slice(0, 10).map((o) => (
                      <div key={o.id} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                        <div className="w-full flex items-end justify-center gap-1 h-36">
                          <div className="w-1/2 rounded-t" style={{ height: `${(n(o.predicted_likes) / maxLikes) * 100}%`, background: '#cdbcff' }} title={`predicted ${k(n(o.predicted_likes))}`} />
                          <div className="w-1/2 rounded-t" style={{ height: `${(n(o.actual_likes) / maxLikes) * 100}%`, background: ACCENT }} title={`actual ${k(n(o.actual_likes))}`} />
                        </div>
                        <div className="text-[10px] text-ink-400 truncate w-full text-center">{(o.name ?? o.handle ?? '').slice(0, 8)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-4 text-[12px] text-ink-600">
                    <Legend c="#cdbcff" label="Predicted" /><Legend c={ACCENT} label="Actual" />
                  </div>
                </>
              )}
            </div>

            {/* per-campaign */}
            <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
              <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-ink-400 border-b border-border">
                <span>Campaign</span><span>Creators</span><span>Reach</span><span>Spend</span><span>Status</span>
              </div>
              {data.per_campaign.map((p) => (
                <a key={p.id} href={`/campaigns/${p.id}`} className="grid grid-cols-[1.6fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 items-center border-b border-border-soft last:border-0 text-[13px] hover:bg-[#faf9ff]">
                  <span className="font-medium text-ink-900 truncate">{p.name}</span>
                  <span className="tabular-nums text-ink-700">{p.recruits}</span>
                  <span className="tabular-nums text-ink-700">{k(n(p.reach))}</span>
                  <span className="tabular-nums text-ink-700">{inr(n(p.spend))}</span>
                  <span className="text-[11px] uppercase tracking-wider text-ink-400">{p.status}</span>
                </a>
              ))}
              {data.per_campaign.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-400">No campaigns yet.</div>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#F2542D]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
function Legend({ c, label }: { c: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c }} />{label}</span>;
}
