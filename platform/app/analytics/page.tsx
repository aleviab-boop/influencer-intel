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

const STATUS_META: Record<string, { label: string; c: string }> = {
  active: { label: 'Active', c: '#10b981' }, paused: { label: 'Paused', c: '#f59e0b' }, closed: { label: 'Closed', c: '#94a3b8' },
};

export default function AnalyticsPage() {
  const [data, setData] = useState<{ totals: Totals; per_campaign: Perf[]; outcomes: Outcome[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('all');
  const [logging, setLogging] = useState(false);

  function load() {
    setLoading(true);
    fetch(`/api/analytics?period=${period}`).then((r) => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, [period]);

  const outs = (data?.outcomes ?? []).filter((o) => o.predicted_likes != null && o.actual_likes != null);
  const accuracy = outs.length
    ? Math.round(100 - (outs.reduce((s, o) => s + Math.abs(n(o.predicted_likes) - n(o.actual_likes)) / Math.max(1, n(o.predicted_likes)), 0) / outs.length) * 100)
    : null;
  const maxLikes = Math.max(1, ...outs.flatMap((o) => [n(o.predicted_likes), n(o.actual_likes)]));

  // Derived efficiency metrics + campaign status breakdown.
  const t = data?.totals;
  const costPerCreator = t && t.creators > 0 ? t.spend / t.creators : 0;
  const cpm = t && t.reach > 0 ? (t.spend / t.reach) * 1000 : 0; // cost per 1,000 of follower reach
  const statusCounts = (data?.per_campaign ?? []).reduce((m, p) => { m[p.status] = (m[p.status] ?? 0) + 1; return m; }, {} as Record<string, number>);

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
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
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

            {/* efficiency + status breakdown */}
            <div className="grid md:grid-cols-2 gap-3 mb-6">
              <div className="rounded-2xl bg-white border border-border shadow-card grid grid-cols-2 divide-x divide-border-soft overflow-hidden">
                <div className="px-5 py-4">
                  <div className="text-2xl font-bold tabular-nums text-ink-900">{inr(Math.round(costPerCreator))}</div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">Cost / creator</div>
                </div>
                <div className="px-5 py-4">
                  <div className="text-2xl font-bold tabular-nums text-ink-900">{cpm > 0 ? inr(Math.round(cpm)) : '—'}</div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">Est. cost / 1K reach</div>
                </div>
              </div>
              <div className="rounded-2xl bg-white border border-border shadow-card px-5 py-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2.5">Campaigns by status</div>
                <div className="flex flex-wrap gap-2">
                  {['active', 'paused', 'closed'].map((s) => (
                    <span key={s} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium" style={{ background: `${STATUS_META[s]!.c}1a`, color: STATUS_META[s]!.c }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_META[s]!.c }} />
                      {STATUS_META[s]!.label} {statusCounts[s] ?? 0}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* predicted vs real */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-5 mb-6">
              <div className="flex items-center justify-between mb-4 gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-ink-900">Predicted vs. real performance</div>
                  <div className="text-[12px] text-ink-400">Likes per recorded post</div>
                </div>
                <div className="flex items-center gap-4">
                  {accuracy != null && (
                    <div className="text-right">
                      <div className="text-2xl font-bold tabular-nums" style={{ color: ACCENT }}>{accuracy}%</div>
                      <div className="text-[11px] uppercase tracking-wider text-ink-400">accuracy</div>
                    </div>
                  )}
                  <button onClick={() => setLogging((v) => !v)} className="px-3.5 py-2 text-[13px] font-semibold text-white rounded-lg shrink-0" style={{ background: ACCENT }}>{logging ? 'Close' : '+ Log result'}</button>
                </div>
              </div>

              {logging && <LogOutcome onLogged={() => { setLogging(false); load(); }} />}
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

interface PickCreator { id: string; handle: string; display_name: string | null }
function LogOutcome({ onLogged }: { onLogged: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickCreator[]>([]);
  const [picked, setPicked] = useState<PickCreator | null>(null);
  const [f, setF] = useState({ predicted_likes: '', actual_likes: '', predicted_views: '', actual_views: '', post_url: '' });
  const [busy, setBusy] = useState(false);
  const setField = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    if (picked || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/creators?q=${encodeURIComponent(q.trim())}&limit=6`).then((r) => r.json()).then((d) => setResults(d.creators ?? [])).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, picked]);

  async function save() {
    if (!picked || !f.actual_likes) return;
    setBusy(true);
    try {
      const numOr = (v: string) => (v.trim() === '' ? undefined : Number(v));
      const r = await fetch('/api/monitor/outcomes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: picked.id,
          predicted_likes: numOr(f.predicted_likes), actual_likes: numOr(f.actual_likes),
          predicted_views: numOr(f.predicted_views), actual_views: numOr(f.actual_views),
          post_url: f.post_url.trim() || undefined,
        }),
      });
      if (r.ok) onLogged();
    } finally { setBusy(false); }
  }

  const oinp = 'w-full px-3 py-2 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
  return (
    <div className="mb-5 p-4 rounded-xl border border-border bg-[#faf9ff]">
      {!picked ? (
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a creator by handle or name…" className={oinp} autoFocus />
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full max-w-md rounded-xl bg-white border border-border shadow-[0_12px_40px_rgba(0,0,0,0.12)] overflow-hidden">
              {results.map((c) => (
                <button key={c.id} onClick={() => { setPicked(c); setResults([]); }} className="w-full text-left px-3 py-2.5 border-b border-border-soft last:border-0 hover:bg-[#faf9ff]">
                  <span className="text-[13px] font-medium text-ink-900">{c.display_name || `@${c.handle}`}</span>
                  <span className="text-[11px] text-ink-400 ml-2">@{c.handle}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 text-[13px]">
            <span className="font-semibold text-ink-900">{picked.display_name || `@${picked.handle}`}</span>
            <button onClick={() => { setPicked(null); setQ(''); }} className="text-[12px] text-ink-400 hover:text-ink-700">change</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <L label="Predicted likes"><input type="number" value={f.predicted_likes} onChange={setField('predicted_likes')} className={oinp} /></L>
            <L label="Actual likes *"><input type="number" value={f.actual_likes} onChange={setField('actual_likes')} className={oinp} /></L>
            <L label="Predicted views"><input type="number" value={f.predicted_views} onChange={setField('predicted_views')} className={oinp} /></L>
            <L label="Actual views"><input type="number" value={f.actual_views} onChange={setField('actual_views')} className={oinp} /></L>
          </div>
          <div className="mt-2"><L label="Post URL (optional)"><input value={f.post_url} onChange={setField('post_url')} placeholder="https://instagram.com/p/…" className={oinp} /></L></div>
          <div className="mt-3 flex justify-end">
            <button onClick={save} disabled={busy || !f.actual_likes} className="px-5 py-2 text-sm font-semibold text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50">{busy ? 'Saving…' : 'Save result'}</button>
          </div>
        </>
      )}
    </div>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[11px] text-ink-500 mb-1 block">{label}</span>{children}</label>;
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
  return <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c }} />{label}</span>;
}
