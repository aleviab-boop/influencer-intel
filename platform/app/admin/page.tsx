'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const ACCENT = '#6C4DF6';

interface Stats {
  creators: { total: number; active: number };
  scraped: { last_1h: number; last_24h: number };
  jobs: { queued: number; in_progress: number; completed_24h: number; failed_24h: number };
  accounts: { active: number };
  worker_live: boolean;
  last_scrape_at: string | null;
}

function Card({ label, value, sub, accent, href }: { label: string; value: string | number; sub?: string; accent?: boolean; href?: string }) {
  const body = (
    <div className="rounded-2xl border border-[#ececf3] bg-white px-5 py-4 h-full hover:border-[#d9d2f7] transition-colors">
      <div className="text-[12px] font-medium uppercase tracking-wide text-[#999]">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums" style={accent ? { color: ACCENT } : undefined}>{value}</div>
      {sub && <div className="text-[12px] text-[#aaa] mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [agencyTotals, setAgencyTotals] = useState<{ last_24h: number; all: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/admin/stats').then((r) => r.json()).then((d) => { if (alive) setStats(d as Stats); }).catch(() => {});
      fetch('/api/admin/agency-activity').then((r) => r.json()).then((d) => { if (alive) setAgencyTotals(d.totals); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const live = stats?.worker_live;

  return (
    <div className="px-8 py-7">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
          style={live
            ? { background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0' }
            : { background: '#f4f4f6', color: '#888', borderColor: '#e5e5ea' }}
        >
          <span className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-[#bbb]'}`} />
          {live ? 'Scraper live' : 'Scraper idle'}
        </span>
      </div>

      {/* database */}
      <div className="text-[12px] font-semibold uppercase tracking-wider text-[#aab] mb-2">Database</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card label="Creators" value={(stats?.creators.total ?? 0).toLocaleString()} sub={`${(stats?.creators.active ?? 0).toLocaleString()} active`} accent href="/database" />
        <Card label="Scraped 1h" value={stats?.scraped.last_1h ?? 0} sub={`${stats?.scraped.last_24h ?? 0} in 24h`} href="/admin/scraper" />
        <Card label="Agency searches 24h" value={agencyTotals?.last_24h ?? 0} sub={`${agencyTotals?.all ?? 0} all time`} href="/admin/agency" />
        <Card label="Accounts in rotation" value={stats?.accounts.active ?? 0} />
      </div>

      {/* scraper queue */}
      <div className="text-[12px] font-semibold uppercase tracking-wider text-[#aab] mb-2">Scraper queue</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card label="Queued" value={stats?.jobs.queued ?? 0} href="/admin/scraper" />
        <Card label="In progress" value={stats?.jobs.in_progress ?? 0} href="/admin/scraper" />
        <Card label="Completed 24h" value={stats?.jobs.completed_24h ?? 0} />
        <Card label="Failed 24h" value={stats?.jobs.failed_24h ?? 0} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/admin/scraper" className="px-4 py-2.5 rounded-xl text-white text-[14px] font-medium" style={{ background: ACCENT }}>
          Go to Scraper
        </Link>
        <Link href="/lander" className="px-4 py-2.5 rounded-xl text-[14px] font-medium border border-[#e3def9]" style={{ color: ACCENT }}>
          Open Agency Lander
        </Link>
      </div>
    </div>
  );
}
