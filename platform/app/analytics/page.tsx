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

  function load() {
    setLoading(true);
    fetch(`/api/analytics?period=${period}`).then((r) => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, [period]);

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

            {/* performance */}
            <PerformanceSection outcomes={data.outcomes} onReload={load} />

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

function CountUp({ value, active, ms = 700 }: { value: number; active: boolean; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) { setV(0); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, active, ms]);
  return <>{v.toLocaleString('en-IN')}</>;
}

function AccuracyDonut({ value, active }: { value: number; active: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const off = active ? c * (1 - pct / 100) : c;
  const color = pct >= 80 ? '#10b981' : pct >= 55 ? ACCENT : '#f59e0b';
  return (
    <div className="relative w-[66px] h-[66px] shrink-0">
      <svg viewBox="0 0 66 66" className="w-full h-full -rotate-90">
        <circle cx="33" cy="33" r={r} fill="none" stroke="#eef0f6" strokeWidth="7" />
        <circle cx="33" cy="33" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.22,.61,.36,1)' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-[15px] font-bold tabular-nums" style={{ color }}><CountUp value={pct} active={active} />%</span>
      </div>
    </div>
  );
}

function PerformanceSection({ outcomes, onReload }: { outcomes: Outcome[]; onReload: () => void }) {
  const [metric, setMetric] = useState<'likes' | 'views'>('likes');
  const [logging, setLogging] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  // Replay the grow-in animation whenever the metric or data changes.
  useEffect(() => {
    setMounted(false);
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, [metric, outcomes]);

  const pick = (o: Outcome) => metric === 'likes'
    ? { p: n(o.predicted_likes), a: n(o.actual_likes), hasP: o.predicted_likes != null, hasA: o.actual_likes != null }
    : { p: n(o.predicted_views), a: n(o.actual_views), hasP: o.predicted_views != null, hasA: o.actual_views != null };

  const rows = outcomes.map((o) => ({ o, ...pick(o) })).filter((r) => r.hasP && r.hasA).slice(0, 12);
  const accuracy = rows.length ? Math.round(100 - (rows.reduce((s, r) => s + Math.abs(r.p - r.a) / Math.max(1, r.p), 0) / rows.length) * 100) : null;
  const avgVar = rows.length ? Math.round((rows.reduce((s, r) => s + (r.a - r.p) / Math.max(1, r.p), 0) / rows.length) * 100) : 0;
  const maxV = Math.max(1, ...rows.flatMap((r) => [r.p, r.a]));
  const label = (o: Outcome) => (o.name ?? (o.handle ? `@${o.handle}` : 'creator'));

  return (
    <div className="rounded-2xl bg-white border border-border shadow-card p-5 mb-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-[14px] font-bold text-ink-900">Predicted vs. real performance</div>
          <div className="text-[12px] text-ink-400">How forecasts held up against actual {metric} per post</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 p-0.5 rounded-lg bg-[#f1f0f7] border border-border">
            {(['likes', 'views'] as const).map((m) => (
              <button key={m} onClick={() => setMetric(m)} className={`px-3 py-1 rounded-md text-[12px] font-medium capitalize transition-colors ${metric === m ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>{m}</button>
            ))}
          </div>
          <button onClick={() => setLogging((v) => !v)} className="px-3.5 py-2 text-[13px] font-semibold text-white rounded-lg shrink-0" style={{ background: ACCENT }}>{logging ? 'Close' : '+ Log result'}</button>
        </div>
      </div>

      {logging && <LogOutcome onLogged={() => { setLogging(false); onReload(); }} />}

      {rows.length === 0 ? (
        <div className="text-sm text-ink-400 py-12 text-center rounded-xl border border-dashed border-border">
          No {metric} results recorded yet. Hit <span className="font-medium text-ink-600">+ Log result</span> to track a post’s forecast vs. reality.
        </div>
      ) : (
        <>
          {/* summary: accuracy donut + tiles */}
          <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_1fr] gap-3 mb-5 items-stretch">
            <div className="rounded-xl bg-[#fafafc] border border-border px-5 py-3 flex items-center gap-3">
              <AccuracyDonut value={accuracy ?? 0} active={mounted} />
              <div className="text-[10px] uppercase tracking-wider text-ink-400 leading-tight">Forecast<br />accuracy</div>
            </div>
            <div className="rounded-xl bg-[#fafafc] border border-border px-4 py-3 flex flex-col justify-center">
              <div className="text-2xl font-bold tabular-nums text-ink-900"><CountUp value={rows.length} active={mounted} /></div>
              <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-0.5">Posts tracked</div>
            </div>
            <div className="rounded-xl bg-[#fafafc] border border-border px-4 py-3 flex-col justify-center hidden sm:flex">
              <div className="text-2xl font-bold tabular-nums" style={{ color: avgVar >= 0 ? '#10b981' : '#f43f5e' }}>{avgVar >= 0 ? '+' : '−'}<CountUp value={Math.abs(avgVar)} active={mounted} />%</div>
              <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-0.5">Avg vs forecast</div>
            </div>
          </div>

          {/* interactive chart */}
          <div className="relative pt-2" onMouseLeave={() => setHover(null)}>
            {/* gridlines */}
            <div className="absolute left-0 right-0 top-2 h-36 pointer-events-none">
              {[0, 25, 50, 75, 100].map((g) => (
                <div key={g} className="absolute left-0 right-0 border-t border-dashed border-[#eef0f6]" style={{ top: `${100 - g}%` }} />
              ))}
            </div>
            <div className="relative flex items-end gap-2 sm:gap-3 h-36 px-1">
              {rows.map((r, i) => {
                const v = Math.round(((r.a - r.p) / Math.max(1, r.p)) * 100);
                const dim = hover !== null && hover !== i;
                return (
                  <div
                    key={r.o.id}
                    className="flex-1 h-full flex items-end justify-center min-w-0 relative cursor-default transition-opacity"
                    style={{ opacity: dim ? 0.4 : 1 }}
                    onMouseEnter={() => setHover(i)}
                  >
                    {/* tooltip */}
                    {hover === i && (
                      <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-20 w-max max-w-[180px] rounded-lg bg-ink-900 text-white px-3 py-2 shadow-lg text-[11px] leading-relaxed">
                        <div className="font-semibold mb-0.5 truncate">{label(r.o)}</div>
                        <div className="text-white/70">Predicted <span className="text-white font-medium tabular-nums">{k(r.p)}</span></div>
                        <div className="text-white/70">Actual <span className="text-white font-medium tabular-nums">{k(r.a)}</span></div>
                        <div className="mt-0.5" style={{ color: v >= 0 ? '#6ee7b7' : '#fda4af' }}>{v >= 0 ? '▲' : '▼'} {Math.abs(v)}% vs forecast</div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 -mt-1 rotate-45 bg-ink-900" />
                      </div>
                    )}
                    <div className="w-full h-full flex items-end justify-center gap-1">
                      <div className="w-1/2 max-w-[18px] rounded-t" style={{ height: mounted ? `${(r.p / maxV) * 100}%` : '0%', background: '#cdbcff', transition: 'height .7s cubic-bezier(.22,.61,.36,1)', transitionDelay: `${i * 45}ms` }} />
                      <div className="w-1/2 max-w-[18px] rounded-t" style={{ height: mounted ? `${(r.a / maxV) * 100}%` : '0%', background: ACCENT, transition: 'height .7s cubic-bezier(.22,.61,.36,1)', transitionDelay: `${i * 45 + 90}ms` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 sm:gap-3 px-1 mt-1.5 border-t border-border-soft pt-1.5">
              {rows.map((r, i) => (
                <div key={r.o.id} className="flex-1 text-[10px] text-center truncate min-w-0" style={{ color: hover === i ? ACCENT : '#9aa0ad', fontWeight: hover === i ? 600 : 400 }}>{label(r.o).replace('@', '').slice(0, 7)}</div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex gap-4 text-[12px] text-ink-600"><Legend c="#cdbcff" label="Predicted" /><Legend c={ACCENT} label="Actual" /></div>

          {/* per-post breakdown */}
          <div className="mt-5 rounded-xl border border-border overflow-hidden">
            <div className="hidden sm:grid grid-cols-[1.4fr_1fr_1fr_0.9fr] px-4 py-2.5 bg-[#f7f7fb] text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
              <span>Creator</span><span className="text-right">Predicted</span><span className="text-right">Actual</span><span className="text-right">vs forecast</span>
            </div>
            {rows.map((r) => {
              const v = Math.round(((r.a - r.p) / Math.max(1, r.p)) * 100);
              const beat = v >= 0;
              return (
                <div key={r.o.id} className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr_0.9fr] gap-y-1 px-4 py-2.5 border-t border-border-soft items-center text-[13px]">
                  <span className="text-ink-900 font-medium truncate col-span-2 sm:col-span-1">{label(r.o)}</span>
                  <span className="text-ink-500 tabular-nums sm:text-right"><span className="sm:hidden text-ink-400">Predicted </span>{k(r.p)}</span>
                  <span className="text-ink-800 tabular-nums sm:text-right font-medium"><span className="sm:hidden text-ink-400">Actual </span>{k(r.a)}</span>
                  <span className="sm:text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums" style={{ background: beat ? '#ecfdf5' : '#fff1f2', color: beat ? '#047857' : '#e11d48' }}>{beat ? '▲' : '▼'} {Math.abs(v)}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
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
