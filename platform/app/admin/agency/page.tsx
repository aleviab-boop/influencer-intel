'use client';

import { useEffect, useState } from 'react';
import { StatCard, PageHeader, useTrend } from '@/components/admin-ui';

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
    const load = () => fetch('/api/admin/agency-activity').then((r) => r.json()).then((d) => { if (alive) setData(d as Activity); }).catch(() => {});
    load();
    const t = setInterval(load, 8_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const recent = data?.recent ?? [];
  const trend = useTrend(data?.totals.last_24h);

  return (
    <div className="px-8 py-7">
      <PageHeader
        title="Agency"
        subtitle="What agencies are searching on the lander — every prompt hits the database the scraper builds."
      />

      <div className="grid grid-cols-3 gap-3.5 mb-7 max-w-2xl">
        <StatCard label="Last hour" value={data?.totals.last_1h ?? 0} icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>} />
        <StatCard label="Last 24h" value={data?.totals.last_24h ?? 0} color="#0ea5e9" trend={trend} />
        <StatCard label="All time" value={(data?.totals.all ?? 0).toLocaleString()} color="#10b981" />
      </div>

      <div className="rounded-2xl border border-[#ececf3] bg-white overflow-hidden shadow-[0_2px_16px_rgba(20,20,60,0.03)]">
        <div className="px-5 py-3 border-b border-[#f1f1f6] text-[13px] font-semibold text-[#555]" style={{ background: 'linear-gradient(90deg, #faf9ff, #fff)' }}>
          Recent searches
        </div>
        {recent.length === 0 ? (
          <div className="px-5 py-12 text-center text-[14px] text-[#aaa]">
            No agency searches yet. They&apos;ll appear here as agencies use the lander.
          </div>
        ) : (
          <div className="divide-y divide-[#f5f5f8]">
            {recent.map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-center gap-4 hover:bg-[#faf9ff] transition-colors">
                <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: '#f4f0ff' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9b7bff" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                </span>
                <span className="flex-1 min-w-0 text-[14px] text-[#222] truncate">{r.prompt}</span>
                <span className="text-[12px] font-medium text-[#666] tabular-nums shrink-0 px-2 py-0.5 rounded-md bg-[#f5f5f8]">{r.result_count} results</span>
                <span className="text-[12px] text-[#aaa] tabular-nums shrink-0 w-16 text-right">{timeAgo(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
