'use client';

import { useEffect, useState } from 'react';
import { StatCard, PageHeader } from '@/components/admin-ui';

type Period = '7d' | '30d' | '90d' | 'all';
interface KV { k: string; n: number }
interface Analytics {
  period: Period;
  db: {
    total: number; active: number; indian: number; verified: number;
    completeness: { follower: number; engagement: number; quality: number; gender: number };
    tiers: { nano: number; micro: number; mid: number; mega: number; unknown: number };
    gender: { female: number; male: number; unlabeled: number };
    niches: KV[];
    cities: KV[];
    er_buckets: { label: string; n: number }[];
    quality_bands: { b: string; n: number }[];
  };
  freshness: { d1: number; d7: number; d30: number; stale30: number; stale90: number; daily: { d: string; n: number }[] };
  funnel: { applied: number; invited: number; contacted: number; recruited: number; declined: number };
  campaigns: {
    totals: { campaigns: number; creators: number; reach: number; spend: number; avg_quality: number };
    per_campaign: { id: string; name: string; status: string; recruits: number; reach: number; spend: number }[];
    outcomes: unknown[];
  } | null;
}

const PERIODS: Period[] = ['7d', '30d', '90d', 'all'];
const PERIOD_LABEL: Record<Period, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' };

const kfmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
const inr = (n: number): string => '₹' + (n >= 1e7 ? (n / 1e7).toFixed(1) + 'Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + 'L' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export default function AdminAnalyticsPage() {
  const [period, setPeriod] = useState<Period>('all');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/admin/analytics?period=${period}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setData(d as Analytics); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  const db = data?.db;
  const total = db?.total ?? 0;
  const f = data?.freshness;
  const fn = data?.funnel;
  const camp = data?.campaigns;

  return (
    <div className="px-8 py-7">
      <PageHeader
        title="Analytics"
        subtitle="Two views in one: the creator database (inventory, quality, coverage) and the recruitment funnel + campaign performance."
      />

      {loading && !data ? (
        <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
      ) : (
        <>
          {/* ============ DATABASE ============ */}
          <SectionLabel>Creator database</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3.5 mb-4">
            <StatCard label="Creators" value={total.toLocaleString()} sub={`${(db?.active ?? 0).toLocaleString()} active`} />
            <StatCard label="Indian" value={`${pct(db?.indian ?? 0, total)}%`} sub={`${(db?.indian ?? 0).toLocaleString()} creators`} color="#10b981" />
            <StatCard label="Verified" value={(db?.verified ?? 0).toLocaleString()} sub={`${pct(db?.verified ?? 0, total)}% of DB`} color="#0ea5e9" />
            <StatCard label="With followers" value={`${pct(db?.completeness.follower ?? 0, total)}%`} sub="have counts" color="#f59e0b" />
            <StatCard label="With ER" value={`${pct(db?.completeness.engagement ?? 0, total)}%`} sub="engagement data" color="#8b5cf6" />
            <StatCard label="Gender labeled" value={`${pct(db?.completeness.gender ?? 0, total)}%`} sub={`${(db?.completeness.gender ?? 0).toLocaleString()} tagged`} color="#ec4899" />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <Panel title="Top niches">
              <BarList items={(db?.niches ?? []).map((x) => ({ label: x.k, n: x.n }))} color="#6C4DF6" total={total} />
            </Panel>
            <Panel title="Top locations">
              <BarList items={(db?.cities ?? []).map((x) => ({ label: x.k, n: x.n }))} color="#0ea5e9" total={total} />
            </Panel>
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mb-4">
            <Panel title="Follower tiers">
              <BarList
                color="#f59e0b"
                total={total}
                items={[
                  { label: 'Nano (<10K)', n: db?.tiers.nano ?? 0 },
                  { label: 'Micro (10–100K)', n: db?.tiers.micro ?? 0 },
                  { label: 'Mid (100K–1M)', n: db?.tiers.mid ?? 0 },
                  { label: 'Mega (1M+)', n: db?.tiers.mega ?? 0 },
                  { label: 'Unknown', n: db?.tiers.unknown ?? 0 },
                ]}
              />
            </Panel>
            <Panel title="Gender">
              <BarList
                color="#ec4899"
                total={total}
                items={[
                  { label: 'Female', n: db?.gender.female ?? 0 },
                  { label: 'Male', n: db?.gender.male ?? 0 },
                  { label: 'Unlabeled', n: db?.gender.unlabeled ?? 0 },
                ]}
              />
            </Panel>
            <Panel title="Engagement rate">
              <BarList color="#8b5cf6" items={(db?.er_buckets ?? []).map((x) => ({ label: x.label, n: x.n }))} />
            </Panel>
          </div>

          {/* ============ FRESHNESS ============ */}
          <SectionLabel>Crawl freshness</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 mb-4">
            <StatCard label="Scraped 24h" value={(f?.d1 ?? 0).toLocaleString()} color="#10b981" />
            <StatCard label="Scraped 7d" value={(f?.d7 ?? 0).toLocaleString()} color="#0ea5e9" />
            <StatCard label="Scraped 30d" value={(f?.d30 ?? 0).toLocaleString()} color="#6C4DF6" />
            <StatCard label="Stale 30d+" value={(f?.stale30 ?? 0).toLocaleString()} sub="need refresh" color="#f59e0b" />
            <StatCard label="Stale 90d+" value={(f?.stale90 ?? 0).toLocaleString()} sub="very stale" color="#ef4444" />
          </div>
          {(f?.daily?.length ?? 0) > 1 && (
            <Panel title="Creators scraped per day (last 30d)" className="mb-4">
              <DayBars data={f!.daily} />
            </Panel>
          )}

          {/* ============ RECRUITMENT FUNNEL ============ */}
          <SectionLabel>Recruitment funnel</SectionLabel>
          <Panel title="Pipeline across all campaigns" className="mb-4">
            {fn && (fn.applied + fn.invited + fn.contacted + fn.recruited + fn.declined) > 0 ? (
              <Funnel fn={fn} />
            ) : (
              <Empty>No recruits yet. Shortlist creators from the scraper search into a campaign.</Empty>
            )}
          </Panel>

          {/* ============ CAMPAIGN PERFORMANCE ============ */}
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5 mt-6">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-[#aab]">Campaign performance</div>
            <div className="flex gap-1 p-1 rounded-xl bg-white border border-[#ececf3] w-max shadow-[0_2px_16px_rgba(20,20,60,0.03)]">
              {PERIODS.map((pp) => (
                <button key={pp} onClick={() => setPeriod(pp)} className={`px-3 py-1.5 rounded-lg text-[13px] transition-colors ${period === pp ? 'bg-[#6C4DF6] text-white' : 'text-[#666] hover:text-[#111]'}`}>
                  {PERIOD_LABEL[pp]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-4">
            <StatCard label="Campaigns" value={camp?.totals.campaigns ?? 0} sub={PERIOD_LABEL[period]} />
            <StatCard label="Creators recruited" value={camp?.totals.creators ?? 0} color="#0ea5e9" />
            <StatCard label="Total reach" value={kfmt(camp?.totals.reach ?? 0)} color="#8b5cf6" />
            <StatCard label="Committed spend" value={inr(camp?.totals.spend ?? 0)} color="#f59e0b" />
          </div>
          <Panel title="By campaign">
            {camp && camp.per_campaign.length > 0 ? (
              <div className="divide-y divide-[#f5f5f8]">
                <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#aab]">
                  <span>Campaign</span><span className="text-right">Recruits</span><span className="text-right">Reach</span><span className="text-right">Spend</span>
                </div>
                {camp.per_campaign.map((c) => (
                  <div key={c.id} className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 items-center hover:bg-[#faf9ff] transition-colors">
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium text-[#111] truncate">{c.name}</div>
                      <div className="text-[11px] text-[#aab] capitalize">{c.status}</div>
                    </div>
                    <div className="text-[13px] text-right tabular-nums text-[#444]">{c.recruits}</div>
                    <div className="text-[13px] text-right tabular-nums text-[#444]">{kfmt(c.reach)}</div>
                    <div className="text-[13px] text-right tabular-nums font-semibold text-[#6C4DF6]">{inr(c.spend)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No campaigns in this period.</Empty>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-semibold uppercase tracking-wider text-[#aab] mb-2.5 mt-6 first:mt-0">{children}</div>;
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[#ececf3] bg-white overflow-hidden shadow-[0_2px_16px_rgba(20,20,60,0.03)] ${className ?? ''}`}>
      <div className="px-5 py-3 border-b border-[#f1f1f6] text-[13px] font-semibold text-[#555]" style={{ background: 'linear-gradient(90deg, #faf9ff, #fff)' }}>{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-[13px] text-[#aaa]">{children}</div>;
}

// A ranked horizontal-bar list. If `total` is given, the right-hand number also
// shows the share of the whole DB; otherwise bars are scaled to the max item.
function BarList({ items, color, total }: { items: { label: string; n: number }[]; color: string; total?: number }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  if (items.every((i) => i.n === 0)) return <Empty>No data yet.</Empty>;
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3">
          <div className="w-28 shrink-0 text-[12px] text-[#555] truncate capitalize" title={it.label}>{it.label}</div>
          <div className="flex-1 h-4 rounded-md bg-[#f3f2fa] overflow-hidden">
            <div className="h-4 rounded-md transition-all duration-500" style={{ width: `${Math.max(2, (it.n / max) * 100)}%`, background: `linear-gradient(90deg, ${color}, ${color}bb)` }} />
          </div>
          <div className="w-20 shrink-0 text-right text-[12px] tabular-nums text-[#444]">
            {it.n.toLocaleString()}{total ? <span className="text-[#bbb]"> · {pct(it.n, total)}%</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function DayBars({ data }: { data: { d: string; n: number }[] }) {
  const max = Math.max(1, ...data.map((x) => x.n));
  return (
    <div className="flex items-end gap-[3px] h-28">
      {data.map((x) => (
        <div key={x.d} className="flex-1 group relative flex flex-col justify-end" title={`${x.d}: ${x.n}`}>
          <div className="rounded-t-sm transition-all" style={{ height: `${Math.max(3, (x.n / max) * 100)}%`, background: 'linear-gradient(180deg, #9b7bff, #6C4DF6)' }} />
        </div>
      ))}
    </div>
  );
}

function Funnel({ fn }: { fn: { applied: number; invited: number; contacted: number; recruited: number; declined: number } }) {
  // Active pipeline stages (applied+invited are the top of funnel); declined is
  // shown separately as it's an exit, not a stage.
  const top = fn.applied + fn.invited;
  const stages = [
    { label: 'Invited / applied', n: top, color: '#94a3b8' },
    { label: 'Contacted', n: fn.contacted, color: '#0ea5e9' },
    { label: 'Recruited', n: fn.recruited, color: '#10b981' },
  ];
  const max = Math.max(1, ...stages.map((s) => s.n));
  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => {
        const prev = i === 0 ? s.n : stages[i - 1]!.n;
        const conv = prev > 0 ? Math.round((s.n / prev) * 100) : 0;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-32 shrink-0 text-[13px] text-[#555]">{s.label}</div>
            <div className="flex-1 h-7 rounded-lg bg-[#f3f2fa] overflow-hidden">
              <div className="h-7 rounded-lg flex items-center px-2.5 text-[12px] font-semibold text-white transition-all duration-500" style={{ width: `${Math.max(6, (s.n / max) * 100)}%`, background: `linear-gradient(90deg, ${s.color}, ${s.color}cc)` }}>{s.n}</div>
            </div>
            <div className="w-16 shrink-0 text-right text-[12px] tabular-nums text-[#999]">{i > 0 ? `${conv}%` : ''}</div>
          </div>
        );
      })}
      {fn.declined > 0 && <div className="text-[12px] text-[#aab] pt-1">{fn.declined} declined / dropped</div>}
    </div>
  );
}
