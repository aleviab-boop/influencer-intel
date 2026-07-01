'use client';

import { useEffect, useState } from 'react';
import { LiveSearch } from '@/components/live-search';

const ACCENT = '#6C4DF6';

interface Stats {
  creators: { total: number; active: number };
  scraped: { last_1h: number; last_24h: number };
  jobs: { queued: number; in_progress: number; completed_24h: number; failed_24h: number };
  accounts: { active: number };
  worker_live: boolean;
}

interface RecentCreator {
  handle: string;
  display_name: string;
  follower_count: number | null;
  category: string;
  is_verified: boolean;
  profile_photo_url: string | null;
  last_scraped_at: string;
}
interface Account {
  handle: string;
  status: string;
  daily_action_count: number;
  total_scrapes: number;
  expired: boolean;
}

function usePoll<T>(url: string, intervalMs = 10_000): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(url).then((r) => r.json()).then((d) => { if (alive) setData(d as T); }).catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [url, intervalMs]);
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

function Stat({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-[#ececf3] bg-white px-5 py-4">
      <div className="text-[12px] font-medium uppercase tracking-wide text-[#999]">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums" style={accent ? { color: ACCENT } : undefined}>{value}</div>
      {sub && <div className="text-[12px] text-[#aaa] mt-0.5">{sub}</div>}
    </div>
  );
}

export default function AdminScraperPage() {
  const stats = usePoll<Stats>('/api/admin/stats');
  const recent = usePoll<{ creators: RecentCreator[]; accounts: Account[] }>('/api/admin/recent-scrapes', 8_000);
  const live = stats?.worker_live;

  return (
    <div className="px-8 py-7">
      <div className="mb-6">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight">Scraper</h1>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
            style={live
              ? { background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0' }
              : { background: '#f4f4f6', color: '#888', borderColor: '#e5e5ea' }}
          >
            <span className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-[#bbb]'}`} />
            {live ? 'Worker live' : 'Worker idle'}
          </span>
        </div>
        <p className="mt-1 text-[14px] text-[#777]">
          The browser worker crawls Instagram and stores every creator to the database. Search below to crawl a niche live.
        </p>
      </div>

      {/* live status strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
        <Stat label="Creators" value={(stats?.creators.total ?? 0).toLocaleString()} sub={`${(stats?.creators.active ?? 0).toLocaleString()} active`} accent />
        <Stat label="Scraped 1h" value={stats?.scraped.last_1h ?? 0} sub={`${stats?.scraped.last_24h ?? 0} in 24h`} />
        <Stat label="Queued" value={stats?.jobs.queued ?? 0} />
        <Stat label="In progress" value={stats?.jobs.in_progress ?? 0} />
        <Stat label="Accounts" value={stats?.accounts.active ?? 0} sub="in rotation" />
        <Stat label="Failed 24h" value={stats?.jobs.failed_24h ?? 0} />
      </div>

      {/* monitoring: recently scraped + account pool */}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4 mb-7">
        <div className="rounded-2xl border border-[#ececf3] bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f1f1f6] text-[13px] font-semibold text-[#555] flex items-center gap-2">
            Recently scraped
            {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
          {(recent?.creators.length ?? 0) === 0 ? (
            <div className="px-5 py-10 text-center text-[14px] text-[#aaa]">
              Nothing scraped yet. Run the worker (or search below) to start crawling.
            </div>
          ) : (
            <div className="divide-y divide-[#f5f5f8] max-h-[420px] overflow-y-auto">
              {recent!.creators.map((c) => (
                <div key={c.handle} className="px-5 py-2.5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#eee] shrink-0 overflow-hidden">
                    {c.profile_photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.profile_photo_url} alt="" className="w-full h-full object-cover" />
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

        <div className="rounded-2xl border border-[#ececf3] bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f1f1f6] text-[13px] font-semibold text-[#555]">
            Accounts in rotation
          </div>
          {(recent?.accounts.length ?? 0) === 0 ? (
            <div className="px-5 py-10 text-center text-[14px] text-[#aaa]">No accounts captured yet.</div>
          ) : (
            <div className="divide-y divide-[#f5f5f8]">
              {recent!.accounts.map((a) => {
                const ok = a.status === 'active' && !a.expired;
                return (
                  <div key={a.handle} className="px-5 py-3 flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-[#d9534f]'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-[#111] truncate">@{a.handle}</div>
                      <div className="text-[12px] text-[#999]">{a.expired ? 'session expired' : a.status}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-semibold tabular-nums text-[#444]">{a.total_scrapes.toLocaleString()}</div>
                      <div className="text-[11px] text-[#bbb]">total scrapes</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="px-5 py-3 border-t border-[#f1f1f6] text-[12px] text-[#999] leading-relaxed">
            Capture more accounts with <span className="font-mono text-[#666]">npm run capture-session</span> — they join the rotation automatically.
          </div>
        </div>
      </div>

      {/* live crawl */}
      <div className="text-[12px] font-semibold uppercase tracking-wider text-[#aab] mb-2">Crawl a niche live</div>
      <LiveSearch initialMode="crawl" />
    </div>
  );
}
