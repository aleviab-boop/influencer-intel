'use client';

import { useEffect, useState } from 'react';
import { LiveSearch } from '@/components/live-search';
import { StatCard, PageHeader, LiveBadge, useTrend } from '@/components/admin-ui';
import { PageDoodles } from '@/components/page-doodles';

interface Stats {
  creators: { total: number; active: number };
  scraped: { last_1h: number; last_24h: number };
  jobs: { queued: number; in_progress: number; completed_24h: number; failed_24h: number };
  accounts: { active: number };
  worker_live: boolean;
}
interface RecentCreator {
  handle: string; display_name: string; follower_count: number | null; category: string;
  is_verified: boolean; profile_photo_url: string | null; last_scraped_at: string;
}
interface Account {
  handle: string; state: 'ready' | 'cooling' | 'parked' | 'expired'; status: string;
  daily_action_count: number; total_scrapes: number; expired: boolean; cooldown_until: string | null;
  last_used_at: string | null; active: boolean;
}
interface RecentData {
  creators: RecentCreator[];
  accounts: Account[];
  activeCrawl: { target: string; started_at: string } | null;
}
interface Job {
  id: string; job_type: string; target: string; status: string; attempts: number;
  error: string | null; found: number | null;
  queued_at: string | null; started_at: string | null; completed_at: string | null;
}
interface JobsData {
  counts: { completed_24h: number; failed_24h: number; skipped_24h: number; queued: number; in_progress: number };
  jobs: Job[];
}

interface PipelineHealth {
  status: 'healthy' | 'rate_limited' | 'cookie_dead' | 'relay_down' | 'no_relay' | 'no_cookie' | 'error';
  label: string;
  detail: string;
  httpCode: number | null;
  relayConfigured: boolean;
  cookieConfigured: boolean;
  checkedAt: string;
}
// Live-data (cookie/relay/drawer) path status — colour + dot per state.
const PIPELINE_UI: Record<PipelineHealth['status'], { fg: string; bg: string; bd: string; dot: string }> = {
  healthy: { fg: 'text-emerald-700', bg: 'bg-emerald-50', bd: 'border-emerald-200', dot: 'bg-emerald-500 animate-pulse' },
  rate_limited: { fg: 'text-amber-700', bg: 'bg-amber-50', bd: 'border-amber-200', dot: 'bg-amber-500' },
  cookie_dead: { fg: 'text-rose-700', bg: 'bg-rose-50', bd: 'border-rose-200', dot: 'bg-rose-500' },
  relay_down: { fg: 'text-rose-700', bg: 'bg-rose-50', bd: 'border-rose-200', dot: 'bg-rose-500' },
  no_relay: { fg: 'text-rose-700', bg: 'bg-rose-50', bd: 'border-rose-200', dot: 'bg-rose-500' },
  no_cookie: { fg: 'text-rose-700', bg: 'bg-rose-50', bd: 'border-rose-200', dot: 'bg-rose-500' },
  error: { fg: 'text-[#777]', bg: 'bg-[#f4f4f6]', bd: 'border-[#e5e5ea]', dot: 'bg-[#bbb]' },
};

const JOB_STATUS: Record<string, { fg: string; bg: string; label: string }> = {
  completed: { fg: 'text-emerald-700', bg: 'bg-emerald-50', label: 'done' },
  in_progress: { fg: 'text-sky-700', bg: 'bg-sky-50', label: 'crawling' },
  queued: { fg: 'text-[#8a7fd6]', bg: 'bg-[#f3f0ff]', label: 'queued' },
  failed: { fg: 'text-rose-700', bg: 'bg-rose-50', label: 'failed' },
  skipped: { fg: 'text-[#999]', bg: 'bg-[#f4f4f6]', label: 'skipped' },
};

const ACCT_STATE: Record<Account['state'], { label: string; dot: string; fg: string; hint?: string }> = {
  ready: { label: 'ready', dot: 'bg-emerald-500 animate-pulse', fg: 'text-emerald-600' },
  cooling: { label: 'resting', dot: 'bg-amber-500', fg: 'text-amber-600', hint: 'rate-limited — auto-resumes' },
  parked: { label: 'parked', dot: 'bg-rose-500', fg: 'text-rose-600', hint: 'dead/paused — re-capture to revive' },
  expired: { label: 'expired', dot: 'bg-[#c1c1cc]', fg: 'text-[#999]', hint: 'session expired — re-capture' },
};

function usePoll<T>(url: string, intervalMs = 8_000, refreshKey = 0): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    // Only store OK JSON. A 401 (expired admin cookie) or 500 returns an error
    // body like {error:'unauthorized'}; storing that would poison state so the
    // render's `stats.creators.total` / `recent.accounts.length` dereference a
    // field that doesn't exist and crash the whole page into the error boundary.
    const load = () =>
      fetch(url)
        .then((r) => {
          // A 401 means the admin session lapsed. Bounce to the staff sign-in so
          // they can re-auth (the page is otherwise stuck showing empty stats).
          if (r.status === 401) { window.location.href = '/staff'; return null; }
          return r.ok ? r.json() : null;
        })
        .then((d) => { if (alive && d && typeof d === 'object' && !('error' in d)) setData(d as T); })
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [url, intervalMs, refreshKey]); // bumping refreshKey forces an immediate reload
  return data;
}

function fmt(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
// How long until an ISO timestamp in the future, e.g. "42m" / "3h". null if past/absent.
function timeUntil(iso: string | null): string | null {
  if (!iso) return null;
  const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return null;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function AdminScraperPage() {
  // Bumping this forces stats + jobs to reload immediately (e.g. right after a
  // cancel) so the list and counts update live instead of waiting for the poll.
  const [refreshKey, setRefreshKey] = useState(0);
  const stats = usePoll<Stats>('/api/admin/stats', 8_000, refreshKey);
  const recent = usePoll<RecentData>('/api/admin/recent-scrapes', 8_000);
  const jobsData = usePoll<JobsData>('/api/admin/jobs', 8_000, refreshKey);
  // Cancel a queued crawl so it doesn't sit in the queue burning account budget.
  const [cancelled, setCancelled] = useState<Set<string>>(new Set());
  async function cancelJob(id: string) {
    setCancelled((s) => new Set(s).add(id)); // hide immediately
    try {
      const r = await fetch(`/api/admin/jobs?id=${id}`, { method: 'DELETE' });
      if (r.ok) {
        setRefreshKey((n) => n + 1); // delete persisted → refetch so list + counts update live
      } else {
        // delete failed → un-hide so the UI stays truthful (it's still queued)
        setCancelled((s) => { const n = new Set(s); n.delete(id); return n; });
      }
    } catch {
      setCancelled((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }
  // Live-data pipeline health (cookie/relay path). Polled gently — server caches
  // ~60s so this never adds more than ~1 IG request/min.
  const pipeline = usePoll<PipelineHealth>('/api/admin/pipeline-health', 30_000);
  const activeCrawl = recent?.activeCrawl ?? null;
  // The worker is "live" if it wrote a creator in the last ~3min (stats) OR it's
  // mid-crawl right now. A slow crawl can go minutes between DB writes, so trust
  // an in-progress crawl too — otherwise the badge flickers to "idle" while the
  // "Crawling now" banner is showing.
  const live = stats?.worker_live || !!activeCrawl;
  const readyAccounts = recent?.accounts?.filter((a) => a.state === 'ready').length ?? null;
  // Warn only when there's queued work and nothing is actually happening (no
  // recent scrape, no active crawl) — i.e. the worker genuinely needs starting.
  const workerStalled = stats != null && !live && (stats.jobs?.queued ?? 0) > 0;
  const noReadyAccounts = recent != null && readyAccounts === 0;
  // Coverage dashboard links here with ?prefill=<niche> creator in <city> so a
  // gap cell can kick off its crawl in one click.
  const [prefill] = useState(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('prefill') ?? '' : '',
  );
  const scrapedTrend = useTrend(stats?.scraped?.last_24h);
  const queueTrend = useTrend(stats?.jobs?.queued);

  return (
    <div className="relative isolate overflow-hidden px-8 py-7">
      <PageDoodles className="-z-10" />
      <PageHeader
        title="Scraper"
        subtitle="The browser worker crawls Instagram and stores every creator to the database. Search below to crawl a niche live."
        badge={<LiveBadge live={live} label={['Worker live', 'Worker idle']} />}
      />

      {/* worker-stalled / no-account warning */}
      {(workerStalled || noReadyAccounts) && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5">
          <svg className="mt-0.5 shrink-0 text-amber-500" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
          <div className="text-[13px] text-amber-800 leading-relaxed">
            {noReadyAccounts
              ? <>No account is ready to crawl — every account is resting, parked, or expired. <span className="font-medium">Re-capture one</span> (below) or wait for a resting one to recover.</>
              : <>There&apos;s queued work but the worker looks idle. Start it on the crawl host with <span className="font-mono text-amber-900">./run-worker.sh</span>.</>}
          </div>
        </div>
      )}

      {/* live crawl indicator */}
      {recent?.activeCrawl && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[#e3def9] bg-white px-5 py-3.5" style={{ background: 'linear-gradient(90deg, #f7f5ff, #fff)' }}>
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#9b7bff] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#6C4DF6]" />
          </span>
          <div className="text-[13px] text-[#555]">
            Crawling Instagram now for <span className="font-semibold text-[#111]">“{recent.activeCrawl.target}”</span>
            <span className="text-[#999]"> · started {timeAgo(recent.activeCrawl.started_at)} ago</span>
          </div>
        </div>
      )}

      {/* live-data pipeline health (cookie/relay/drawer path) */}
      {pipeline && (() => {
        const ui = PIPELINE_UI[pipeline.status] ?? PIPELINE_UI.error;
        return (
          <div className={`mb-6 flex items-start gap-3 rounded-2xl border px-5 py-3.5 ${ui.bg} ${ui.bd}`}>
            <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${ui.dot}`} />
            <div className="min-w-0 flex-1">
              <div className={`text-[13px] font-semibold ${ui.fg}`}>
                Live data pipeline · {pipeline.label}
                {pipeline.httpCode != null && <span className="font-normal text-[#999]"> · HTTP {pipeline.httpCode}</span>}
              </div>
              <div className="text-[12px] text-[#777] leading-relaxed mt-0.5">{pipeline.detail}</div>
              <div className="text-[11px] text-[#bbb] mt-1">
                relay {pipeline.relayConfigured ? 'configured' : 'not set'} · cookie {pipeline.cookieConfigured ? 'set' : 'missing'} · checked {timeAgo(pipeline.checkedAt)} ago
              </div>
            </div>
          </div>
        );
      })()}

      {/* live status strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3.5 mb-7">
        <StatCard label="Creators" value={(stats?.creators?.total ?? 0).toLocaleString()} sub={`${(stats?.creators?.active ?? 0).toLocaleString()} active`} />
        <StatCard label="Scraped 24h" value={stats?.scraped?.last_24h ?? 0} sub={`${stats?.scraped?.last_1h ?? 0} in 1h`} color="#f59e0b" trend={scrapedTrend} />
        <StatCard label="Queued" value={stats?.jobs?.queued ?? 0} trend={queueTrend} />
        <StatCard label="In progress" value={stats?.jobs?.in_progress ?? 0} color="#0ea5e9" />
        <StatCard label="Accounts" value={stats?.accounts?.active ?? 0} sub="in rotation" color="#10b981" />
        <StatCard label="Failed 24h" value={stats?.jobs?.failed_24h ?? 0} color="#ef4444" />
      </div>

      {/* monitoring: recently scraped + account pool */}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4 mb-8">
        <div className="rounded-2xl border border-[#ececf3] bg-white overflow-hidden shadow-[0_2px_16px_rgba(20,20,60,0.03)]">
          <div className="px-5 py-3 border-b border-[#f1f1f6] text-[13px] font-semibold text-[#555] flex items-center gap-2" style={{ background: 'linear-gradient(90deg, #faf9ff, #fff)' }}>
            Recently scraped
            {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
          {(recent?.creators?.length ?? 0) === 0 ? (
            <div className="px-5 py-10 text-center text-[14px] text-[#aaa]">Nothing scraped yet. Run the worker (or search below) to start crawling.</div>
          ) : (
            <div className="divide-y divide-[#f5f5f8] max-h-[420px] overflow-y-auto">
              {(recent?.creators ?? []).map((c) => (
                <div key={c.handle} className="px-5 py-2.5 flex items-center gap-3 hover:bg-[#faf9ff] transition-colors">
                  <div className="w-8 h-8 rounded-full bg-[#eee] shrink-0 overflow-hidden ring-2 ring-transparent group-hover:ring-[#e3def9]">
                    {c.profile_photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/ig-image?u=${encodeURIComponent(c.profile_photo_url)}`} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-[#111] truncate">@{c.handle}{c.is_verified && <span className="text-[#3897f0] ml-1">✔</span>}</div>
                    <div className="text-[12px] text-[#999] truncate">{c.category || '—'}</div>
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums text-[#444] shrink-0">{fmt(c.follower_count)}</div>
                  <div className="text-[12px] text-[#bbb] tabular-nums shrink-0 w-9 text-right">{timeAgo(c.last_scraped_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#ececf3] bg-white overflow-hidden shadow-[0_2px_16px_rgba(20,20,60,0.03)]">
          <div className="px-5 py-3 border-b border-[#f1f1f6] text-[13px] font-semibold text-[#555] flex items-center justify-between" style={{ background: 'linear-gradient(90deg, #faf9ff, #fff)' }}>
            <span>Accounts in rotation</span>
            {readyAccounts != null && (
              <span className="text-[12px] font-medium text-emerald-600">{readyAccounts} ready</span>
            )}
          </div>
          {(recent?.accounts?.length ?? 0) === 0 ? (
            <div className="px-5 py-10 text-center text-[14px] text-[#aaa]">No accounts captured yet.</div>
          ) : (
            <div className="divide-y divide-[#f5f5f8]">
              {(recent?.accounts ?? []).map((a) => {
                const st = ACCT_STATE[a.state];
                // For a resting account, show the concrete auto-resume ETA if we
                // know it; otherwise fall back to the generic hint.
                const resumesIn = a.state === 'cooling' ? timeUntil(a.cooldown_until) : null;
                const sub = resumesIn ? `resumes in ${resumesIn}` : st.hint;
                return (
                  <div key={a.handle} className={`px-5 py-3 flex items-center gap-3 transition-colors ${a.active ? 'bg-[#f4fbf7]' : 'hover:bg-[#faf9ff]'}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-[#111] truncate">@{a.handle}</span>
                        {a.active && (
                          <span className="inline-flex items-center gap-1 shrink-0 text-[10.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            </span>
                            crawling now
                          </span>
                        )}
                      </div>
                      <div className="text-[12px]">
                        <span className={`font-medium ${st.fg}`}>{st.label}</span>
                        {sub && <span className="text-[#bbb]"> · {sub}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-semibold tabular-nums text-[#444]">{a.total_scrapes.toLocaleString()}</div>
                      <div className="text-[11px] text-[#bbb]">
                        {a.state === 'ready' && a.daily_action_count > 0
                          ? <span className="text-emerald-600">{a.daily_action_count} today</span>
                          : 'scrapes'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="px-5 py-3 border-t border-[#f1f1f6] text-[12px] text-[#999] leading-relaxed">
            Add / re-capture an account: <span className="font-mono text-[#666]">npm run scraper:capture</span> — it joins the rotation automatically.
          </div>
        </div>
      </div>

      {/* recent crawl jobs — what the worker has actually been doing */}
      <div className="rounded-2xl border border-[#ececf3] bg-white overflow-hidden shadow-[0_2px_16px_rgba(20,20,60,0.03)] mb-8">
        <div className="px-5 py-3 border-b border-[#f1f1f6] text-[13px] font-semibold text-[#555] flex items-center justify-between" style={{ background: 'linear-gradient(90deg, #faf9ff, #fff)' }}>
          <span>Recent crawls</span>
          {jobsData?.counts && (
            <span className="text-[12px] font-normal text-[#999] flex items-center gap-2.5">
              <span className="text-emerald-600">{jobsData.counts.completed_24h} done</span>
              {jobsData.counts.failed_24h > 0 && <span className="text-rose-600">{jobsData.counts.failed_24h} failed</span>}
              <span>{Math.max(0, jobsData.counts.queued - (jobsData.jobs ?? []).filter((j) => j.status === 'queued' && cancelled.has(j.id)).length)} queued</span>
              {jobsData.counts.in_progress > 0 && <span className="text-sky-600">{jobsData.counts.in_progress} running</span>}
              <span className="text-[#bbb]">· 24h</span>
            </span>
          )}
        </div>
        {(jobsData?.jobs?.length ?? 0) === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-[#aaa]">No crawl jobs yet. Search below to start one.</div>
        ) : (
          <div className="divide-y divide-[#f5f5f8] max-h-[360px] overflow-y-auto">
            {(jobsData?.jobs ?? []).filter((j) => !cancelled.has(j.id)).map((j) => {
              const st = JOB_STATUS[j.status] ?? { fg: 'text-[#777]', bg: 'bg-[#f4f4f6]', label: j.status };
              const when = j.completed_at ?? j.started_at ?? j.queued_at;
              return (
                <div key={j.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-[#faf9ff] transition-colors group">
                  <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md ${st.fg} ${st.bg}`}>{st.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-[#222] truncate">{j.target}</div>
                    {j.error && <div className="text-[11px] text-rose-500 truncate">{j.error}</div>}
                  </div>
                  {j.found != null && j.found > 0 && (
                    <span className="shrink-0 text-[12px] tabular-nums text-[#666]">+{j.found}</span>
                  )}
                  {j.attempts > 1 && j.status !== 'completed' && (
                    <span className="shrink-0 text-[11px] text-amber-600">×{j.attempts}</span>
                  )}
                  {j.status === 'queued' && (
                    <button
                      onClick={() => cancelJob(j.id)}
                      title="Cancel this queued crawl (frees account budget)"
                      className="shrink-0 w-6 h-6 grid place-items-center rounded-md text-[#c9c4dd] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                  <span className="shrink-0 text-[12px] text-[#bbb] tabular-nums w-9 text-right">{when ? timeAgo(when) : '—'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-[12px] font-semibold uppercase tracking-wider text-[#aab] mb-2.5">Crawl a niche live</div>
      <LiveSearch initialMode="crawl" initialPrompt={prefill} />
    </div>
  );
}
