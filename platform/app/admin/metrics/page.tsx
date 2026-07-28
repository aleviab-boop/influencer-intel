'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const ACCENT = '#6C4DF6';

interface LiveCrawl {
  target_handle: string | null;
  job_type: string | null;
  status: string | null;
  attempts: number;
  started_at: string | null;
  elapsed_s: number;
  account: string | null;
}
interface Account {
  handle: string;
  status: string | null;
  total_scrapes: number;
  daily_actions: number;
  last_used_at: string | null;
  cooldown_until: string | null;
  storage_expires_at: string | null;
  category_focus: string | null;
  geo_focus: string | null;
  jobs_24h: number;
}
interface RecentSearch { prompt: string; result_count: number; created_at: string }
interface RecentLogin { email: string | null; kind: string; name: string | null; meta: { method?: string } | null; created_at: string }
interface Metrics {
  generatedAt: string;
  worker: { live: boolean; last_beat_at: string | null };
  headline: {
    queued: number; in_progress: number; completed_24h: number; skipped_24h: number; failed_24h: number;
    avg_duration_sec: number; oldest_queued_at: string | null;
    searches_today: number; searches_24h: number; searches_7d: number;
    logins_today: number; logins_24h: number; dau_today: number; dau_7d: number;
  };
  live_crawls: LiveCrawl[];
  hourly_throughput: Array<{ bucket: string; n: number }>;
  accounts: Account[];
  recent_searches: RecentSearch[];
  searches_per_day: Array<{ bucket: string; n: number }>;
  top_niches: Array<{ token: string; n: number }>;
  logins_per_day: Array<{ bucket: string; n: number }>;
  recent_logins: RecentLogin[];
}

function fmtDuration(sec: number): string {
  if (sec == null || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function ago(iso: string | null): string {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 0) return 'in ' + fmtDuration(-d);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
function until(iso: string | null): string | null {
  if (!iso) return null;
  const d = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (d <= 0) return null;
  return fmtDuration(d);
}

function StatCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const bar = tone === 'ok' ? '#10b981' : tone === 'warn' ? '#f59e0b' : tone === 'bad' ? '#ef4444' : ACCENT;
  return (
    <div className="rounded-2xl bg-white border border-[#ececf3] shadow-[0_1px_2px_rgba(20,20,40,0.04)] p-4 relative overflow-hidden">
      <span className="absolute top-0 left-0 h-full w-1" style={{ background: `linear-gradient(180deg, ${bar}, transparent)` }} />
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa]">{label}</div>
      <div className="text-[26px] font-bold tabular-nums leading-tight mt-1">{value}</div>
      {sub && <div className="text-[12px] text-[#999] mt-0.5">{sub}</div>}
    </div>
  );
}

function Bars({ data, color = ACCENT }: { data: number[]; color?: string }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-0.5 h-10">
      {data.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(6, (v / max) * 100)}%`, background: color, opacity: v === 0 ? 0.15 : 0.85 }} title={String(v)} />
      ))}
    </div>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-[#ececf3] shadow-[0_1px_2px_rgba(20,20,40,0.04)]">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f1f1f6]">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function MetricsPage() {
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0); // 1s ticker to advance elapsed/ago displays
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/metrics', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setM(await res.json());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 15_000);
    timer.current = setInterval(() => tick((x) => x + 1), 1000);
    return () => { clearInterval(poll); if (timer.current) clearInterval(timer.current); };
  }, []);

  const h = m?.headline;
  const hourly = useMemo(() => (m?.hourly_throughput ?? []).map((x) => x.n), [m]);
  const perDay = useMemo(() => (m?.searches_per_day ?? []).map((x) => x.n), [m]);
  const loginsPerDay = useMemo(() => (m?.logins_per_day ?? []).map((x) => x.n), [m]);
  const oldestQ = until(h?.oldest_queued_at ?? null);

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* header */}
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-[28px] font-bold tracking-tight">Metrics</h1>
        <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full ${m?.worker.live ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f1f1f6] text-[#888]'}`}>
          <span className={`w-2 h-2 rounded-full ${m?.worker.live ? 'bg-emerald-500' : 'bg-[#bbb]'}`} />
          {m?.worker.live ? 'Worker live' : 'Worker idle'}
        </span>
      </div>
      <p className="text-[13px] text-[#888] mb-6">
        Live view of who's crawling, throughput, account health, and what's being searched.
        {m && <span className="ml-1.5 text-[#bbb]">· updated {ago(m.generatedAt)}</span>}
      </p>

      {err && <div className="mb-4 text-[13px] text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">Couldn't load metrics: {err}</div>}

      {/* headline stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active today (DAU)" value={h?.dau_today ?? '—'} tone={h && h.dau_today > 0 ? 'ok' : undefined} sub={`${h?.dau_7d ?? 0} in last 7d`} />
        <StatCard label="Logins today" value={h?.logins_today ?? '—'} sub={`${h?.logins_24h ?? 0} in 24h`} />
        <StatCard label="Searches today" value={h?.searches_today ?? '—'} sub={`${h?.searches_24h ?? 0} in 24h`} />
        <StatCard label="Searches 7d" value={h?.searches_7d ?? '—'} sub="last 7 days" />
        <StatCard label="Crawling now" value={h?.in_progress ?? '—'} tone={h && h.in_progress > 0 ? 'ok' : undefined} sub="in progress" />
        <StatCard label="Queued" value={h?.queued ?? '—'} tone={h && h.queued > 20 ? 'warn' : undefined} sub={oldestQ ? `oldest ${oldestQ}` : 'empty'} />
        <StatCard label="Completed 24h" value={h?.completed_24h ?? '—'} tone="ok" sub={`${h?.skipped_24h ?? 0} skipped · ${h?.failed_24h ?? 0} failed`} />
        <StatCard label="Avg crawl" value={h ? fmtDuration(h.avg_duration_sec) : '—'} sub="per job, 24h" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* live crawls */}
        <Card title="Who's crawling now" right={<span className="text-[12px] text-[#999]">{m?.live_crawls.length ?? 0} active</span>}>
          {m && m.live_crawls.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-[#aaa]">No crawls in progress right now.</div>
          ) : (
            <div className="divide-y divide-[#f4f4f8]">
              {(m?.live_crawls ?? []).map((c, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{c.target_handle || <span className="text-[#aaa]">—</span>}</div>
                    <div className="text-[11px] text-[#999] truncate">
                      {c.job_type || 'crawl'}{c.account ? ` · @${c.account}` : ''}{c.attempts > 1 ? ` · try ${c.attempts}` : ''}
                    </div>
                  </div>
                  <span className="text-[12px] font-semibold tabular-nums text-[#6C4DF6] shrink-0">{fmtDuration(c.elapsed_s + 0)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* throughput */}
        <Card title="Crawl throughput" right={<span className="text-[12px] text-[#999]">completed / hour · 24h</span>}>
          <div className="px-5 py-4">
            <Bars data={hourly.length ? hourly : Array(24).fill(0)} />
            <div className="flex items-center justify-between mt-3 text-[12px]">
              <span className="text-emerald-600 font-medium">{h?.completed_24h ?? 0} completed</span>
              <span className="text-amber-600">{h?.skipped_24h ?? 0} skipped</span>
              <span className="text-rose-600">{h?.failed_24h ?? 0} failed</span>
            </div>
          </div>
        </Card>

        {/* live search feed */}
        <Card title="Live searches" right={<span className="text-[12px] text-[#999]">most recent</span>}>
          {m && m.recent_searches.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-[#aaa]">No searches logged yet.</div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto divide-y divide-[#f4f4f8]">
              {(m?.recent_searches ?? []).map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] truncate" title={s.prompt}>{s.prompt}</div>
                    <div className="text-[11px] text-[#aaa]">{ago(s.created_at)}</div>
                  </div>
                  <span className="text-[12px] tabular-nums text-[#888] shrink-0">{s.result_count} results</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* search volume + top niches */}
        <Card title="Search volume & top niches" right={<span className="text-[12px] text-[#999]">14 days</span>}>
          <div className="px-5 py-4">
            <Bars data={perDay.length ? perDay : Array(14).fill(0)} color="#9b7bff" />
            <div className="mt-4 flex flex-wrap gap-1.5">
              {(m?.top_niches ?? []).map((t) => (
                <span key={t.token} className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-lg bg-[#f4f2ff] text-[#6C4DF6]">
                  {t.token}<span className="text-[#b3a6f0] tabular-nums">{t.n}</span>
                </span>
              ))}
              {m && m.top_niches.length === 0 && <span className="text-[12px] text-[#aaa]">No niche data yet.</span>}
            </div>
          </div>
        </Card>

        {/* logins / active users */}
        <Card title="Logins & active users" right={<span className="text-[12px] text-[#999]">14 days</span>}>
          <div className="px-5 py-4">
            <Bars data={loginsPerDay.length ? loginsPerDay : Array(14).fill(0)} color="#10b981" />
            <div className="flex items-center justify-between mt-3 text-[12px]">
              <span className="text-emerald-600 font-medium">{h?.logins_today ?? 0} logins today</span>
              <span className="text-[#888]">{h?.dau_today ?? 0} active today</span>
              <span className="text-[#888]">{h?.dau_7d ?? 0} active 7d</span>
            </div>
          </div>
          {m && m.recent_logins.length > 0 && (
            <div className="max-h-[220px] overflow-y-auto divide-y divide-[#f4f4f8] border-t border-[#f1f1f6]">
              {m.recent_logins.map((l, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-2">
                  <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-semibold text-[#6C4DF6] bg-[#f4f2ff] shrink-0 uppercase">
                    {(l.name || l.email || '?').trim().charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate" title={l.email ?? ''}>{l.name || l.email || <span className="text-[#aaa]">unknown</span>}</div>
                    <div className="text-[11px] text-[#aaa] truncate">
                      {l.name && l.email ? `${l.email} · ` : ''}{l.kind === 'signup' ? 'signed up' : 'logged in'}{l.meta?.method ? ` · ${l.meta.method}` : ''}
                    </div>
                  </div>
                  <span className="text-[12px] tabular-nums text-[#888] shrink-0">{ago(l.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* account roster */}
      <div className="mt-6">
        <Card title="Account health" right={<span className="text-[12px] text-[#999]">{m?.accounts.length ?? 0} accounts</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[#aab] border-b border-[#f1f1f6]">
                  <th className="px-5 py-2.5 font-medium">Account</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium text-right">Jobs 24h</th>
                  <th className="px-3 py-2.5 font-medium text-right">Total scrapes</th>
                  <th className="px-3 py-2.5 font-medium text-right">Today</th>
                  <th className="px-3 py-2.5 font-medium">Last used</th>
                  <th className="px-3 py-2.5 font-medium">Session</th>
                  <th className="px-5 py-2.5 font-medium">Focus</th>
                </tr>
              </thead>
              <tbody>
                {(m?.accounts ?? []).map((a) => {
                  const cool = until(a.cooldown_until);
                  const expiresIn = until(a.storage_expires_at);
                  const expired = a.storage_expires_at != null && !expiresIn;
                  const statusTone = a.status === 'active' ? 'text-emerald-700 bg-emerald-50' : a.status === 'cooldown' || cool ? 'text-amber-700 bg-amber-50' : 'text-[#888] bg-[#f4f4f8]';
                  return (
                    <tr key={a.handle} className="border-b border-[#f6f6fa] hover:bg-[#fafaff]">
                      <td className="px-5 py-2.5 font-medium">@{a.handle}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-md ${statusTone}`}>
                          {cool ? `cooldown ${cool}` : a.status || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{a.jobs_24h}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#666]">{a.total_scrapes.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#666]">{a.daily_actions}</td>
                      <td className="px-3 py-2.5 text-[#888]">{ago(a.last_used_at)}</td>
                      <td className="px-3 py-2.5">
                        {expired ? (
                          <span className="text-[11px] font-medium text-rose-600">expired</span>
                        ) : expiresIn ? (
                          <span className="text-[11px] text-[#888]">expires {expiresIn}</span>
                        ) : (
                          <span className="text-[11px] text-[#bbb]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-[12px] text-[#999] truncate max-w-[180px]">
                        {[a.category_focus, a.geo_focus].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  );
                })}
                {m && m.accounts.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-8 text-center text-[13px] text-[#aaa]">No accounts in the pool.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
