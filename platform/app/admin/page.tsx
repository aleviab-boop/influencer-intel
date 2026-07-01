'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ACCENT, StatCard, PageHeader, LiveBadge, useTrend } from '@/components/admin-ui';

interface Stats {
  creators: { total: number; active: number };
  scraped: { last_1h: number; last_24h: number };
  jobs: { queued: number; in_progress: number; completed_24h: number; failed_24h: number };
  accounts: { active: number };
  worker_live: boolean;
}

const I = {
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  bolt: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>,
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  key: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5" /><path d="M10.5 12.5 20 3M17 6l2 2M14 9l2 2" /></svg>,
};

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [agency, setAgency] = useState<{ last_24h: number; all: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/admin/stats').then((r) => r.json()).then((d) => { if (alive) setStats(d as Stats); }).catch(() => {});
      fetch('/api/admin/agency-activity').then((r) => r.json()).then((d) => { if (alive) setAgency(d.totals); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 8_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const creatorsTrend = useTrend(stats?.creators.total);
  const scrapedTrend = useTrend(stats?.scraped.last_24h);
  const agencyTrend = useTrend(agency?.last_24h);
  const queueTrend = useTrend(stats?.jobs.queued);

  return (
    <div className="px-8 py-7">
      <PageHeader
        title="Dashboard"
        subtitle="Live overview of the scraper, the creator database, and agency activity."
        badge={<LiveBadge live={stats?.worker_live} label={['Scraper live', 'Scraper idle']} />}
      />

      <div className="text-[12px] font-semibold uppercase tracking-wider text-[#aab] mb-2.5">Database</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-7">
        <StatCard label="Creators" value={(stats?.creators.total ?? 0).toLocaleString()} sub={`${(stats?.creators.active ?? 0).toLocaleString()} active`} icon={I.users} trend={creatorsTrend} />
        <StatCard label="Scraped 24h" value={(stats?.scraped.last_24h ?? 0).toLocaleString()} sub={`${stats?.scraped.last_1h ?? 0} in the last hour`} icon={I.bolt} trend={scrapedTrend} color="#f59e0b" />
        <StatCard label="Agency searches 24h" value={agency?.last_24h ?? 0} sub={`${agency?.all ?? 0} all time`} icon={I.search} trend={agencyTrend} color="#0ea5e9" />
        <StatCard label="Accounts in rotation" value={stats?.accounts.active ?? 0} sub="capture more to scale" icon={I.key} color="#10b981" />
      </div>

      <div className="text-[12px] font-semibold uppercase tracking-wider text-[#aab] mb-2.5">Scraper queue</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-7">
        <StatCard label="Queued" value={stats?.jobs.queued ?? 0} trend={queueTrend} />
        <StatCard label="In progress" value={stats?.jobs.in_progress ?? 0} color="#0ea5e9" />
        <StatCard label="Completed 24h" value={(stats?.jobs.completed_24h ?? 0).toLocaleString()} color="#10b981" />
        <StatCard label="Failed 24h" value={(stats?.jobs.failed_24h ?? 0).toLocaleString()} color="#ef4444" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/admin/scraper" className="px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
          Go to Scraper →
        </Link>
        <Link href="/lander" className="px-4 py-2.5 rounded-xl text-[14px] font-semibold border border-[#e3def9] hover:bg-[#f7f5ff] transition-colors" style={{ color: ACCENT }}>
          Open Agency Lander
        </Link>
      </div>
    </div>
  );
}
