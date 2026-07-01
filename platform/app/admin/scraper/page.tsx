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

function useStats(intervalMs = 10_000): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/admin/stats')
        .then((r) => r.json())
        .then((d) => { if (alive) setStats(d as Stats); })
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return stats;
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
  const stats = useStats();
  const live = stats?.worker_live;

  return (
    <div className="px-8 py-7">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
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
            The browser worker crawls Instagram and stores every creator to the database.
            Search below to crawl a niche live.
          </p>
        </div>
      </div>

      {/* live status strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-7">
        <Stat label="Creators" value={(stats?.creators.total ?? 0).toLocaleString()} sub={`${(stats?.creators.active ?? 0).toLocaleString()} active`} accent />
        <Stat label="Scraped 1h" value={stats?.scraped.last_1h ?? 0} sub={`${stats?.scraped.last_24h ?? 0} in 24h`} />
        <Stat label="Queued" value={stats?.jobs.queued ?? 0} />
        <Stat label="In progress" value={stats?.jobs.in_progress ?? 0} />
        <Stat label="Accounts" value={stats?.accounts.active ?? 0} sub="in rotation" />
        <Stat label="Failed 24h" value={stats?.jobs.failed_24h ?? 0} />
      </div>

      {/* live crawl */}
      <LiveSearch initialMode="crawl" />
    </div>
  );
}
