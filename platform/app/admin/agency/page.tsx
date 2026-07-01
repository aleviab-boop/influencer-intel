'use client';

import { useEffect, useState } from 'react';

const ACCENT = '#6C4DF6';

interface Activity {
  recent: Array<{ id: string; prompt: string; result_count: number; created_at: string }>;
  totals: { all: number; last_24h: number; last_1h: number };
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AdminAgencyPage() {
  const [data, setData] = useState<Activity | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/admin/agency-activity')
        .then((r) => r.json())
        .then((d) => { if (alive) setData(d as Activity); })
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const recent = data?.recent ?? [];

  return (
    <div className="px-8 py-7">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Agency</h1>
        <p className="mt-1 text-[14px] text-[#777]">
          What agencies are searching on the lander — every prompt hits the database the scraper builds.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-7 max-w-xl">
        <div className="rounded-2xl border border-[#ececf3] bg-white px-5 py-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-[#999]">Last hour</div>
          <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: ACCENT }}>{data?.totals.last_1h ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-[#ececf3] bg-white px-5 py-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-[#999]">Last 24h</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{data?.totals.last_24h ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-[#ececf3] bg-white px-5 py-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-[#999]">All time</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{data?.totals.all ?? 0}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#ececf3] bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-[#f1f1f6] text-[13px] font-semibold text-[#555]">
          Recent searches
        </div>
        {recent.length === 0 ? (
          <div className="px-5 py-10 text-center text-[14px] text-[#aaa]">
            No agency searches yet. They&apos;ll appear here as agencies use the lander.
          </div>
        ) : (
          <div className="divide-y divide-[#f5f5f8]">
            {recent.map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-center gap-4">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa" strokeWidth="2" strokeLinecap="round" className="shrink-0"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <span className="flex-1 min-w-0 text-[14px] text-[#222] truncate">{r.prompt}</span>
                <span className="text-[12px] text-[#888] tabular-nums shrink-0">{r.result_count} results</span>
                <span className="text-[12px] text-[#aaa] tabular-nums shrink-0 w-16 text-right">{timeAgo(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
