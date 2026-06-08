'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MarketingNav } from '@/components/marketing';

interface ProgramSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  recruit_count: number;
  recruited_count: number;
  budget: number | string | null;
  spent: number | string | null;
  created_at: string;
}

const num = (v: number | string | null): number => (v == null ? 0 : Number(v) || 0);
const inr = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtDate = (s: string): string => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const FILTERS = ['all', 'active', 'paused', 'closed'] as const;
type Filter = (typeof FILTERS)[number];

export default function CampaignsPage() {
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/programs');
      const d = await r.json();
      if (!r.ok) setError(d.error ?? 'Failed to load campaigns');
      else setPrograms(d.programs ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (newName.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (r.ok) { setNewName(''); setCreating(false); await load(); }
    } finally {
      setBusy(false);
    }
  }

  const totalRecruited = programs.reduce((s, p) => s + p.recruit_count, 0);
  const totalConfirmed = programs.reduce((s, p) => s + p.recruited_count, 0);
  const totalSpend = programs.reduce((s, p) => s + num(p.spent), 0);
  const activeCount = programs.filter((p) => p.status === 'active').length;

  const counts = useMemo(() => ({
    all: programs.length,
    active: programs.filter((p) => p.status === 'active').length,
    paused: programs.filter((p) => p.status === 'paused').length,
    closed: programs.filter((p) => p.status === 'closed').length,
  }), [programs]);

  const visible = programs.filter((p) =>
    (filter === 'all' || p.status === filter) &&
    (query.trim() === '' || p.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-9">
        {/* Title */}
        <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Campaign Management</div>
            <h1 className="text-2xl font-bold text-ink-900">Your campaigns</h1>
          </div>
          <button onClick={() => setCreating((c) => !c)} className="px-4 py-2.5 text-sm font-semibold text-white bg-ink-900 rounded-xl hover:bg-ink-800 transition-colors">+ New campaign</button>
        </div>

        {/* Metric strip */}
        <div className="rounded-2xl bg-white border border-border shadow-card grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border-soft mb-5 overflow-hidden">
          <Metric label="Total campaigns" value={String(programs.length)} sub={`${activeCount} active`} />
          <Metric label="Creators recruited" value={String(totalRecruited)} />
          <Metric label="Confirmed" value={String(totalConfirmed)} />
          <Metric label="Total committed spend" value={inr(totalSpend)} accent />
        </div>

        {/* Create row */}
        {creating && (
          <div className="mb-5 flex items-center gap-2 p-3 rounded-xl bg-white border border-border shadow-card">
            <input
              type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus
              placeholder="Campaign name (e.g. Summer Goa 2026)"
              className="flex-1 px-3 py-2 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900"
            />
            <button onClick={create} disabled={busy || newName.trim().length < 2} className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50">{busy ? 'Creating…' : 'Create'}</button>
            <button onClick={() => setCreating(false)} className="px-3 py-2 text-sm text-ink-500 hover:text-ink-900">Cancel</button>
          </div>
        )}

        {/* Toolbar: filters + search */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex gap-1 p-1 rounded-xl bg-white border border-border w-max">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-[13px] capitalize transition-colors ${filter === f ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'}`}>
                {f} <span className={filter === f ? 'text-white/70' : 'text-ink-400'}>{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search campaigns…" className="pl-9 pr-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-ink-900 w-[220px]" />
          </div>
        </div>

        {error && <div className="mb-4 text-sm text-rose-700">{error}</div>}

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : programs.length === 0 ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">
            No campaigns yet. Recruit creators from <Link href="/lander" className="text-ink-900 underline">the home search</Link>, or create one above.
          </div>
        ) : visible.length === 0 ? (
          <div className="text-sm text-ink-400 py-16 text-center rounded-2xl border border-dashed border-border bg-white">No campaigns match this filter.</div>
        ) : (
          <div className="space-y-2.5">
            {visible.map((p) => {
              const budget = num(p.budget);
              const spent = num(p.spent);
              const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
              const over = budget > 0 && spent > budget;
              return (
                <Link key={p.id} href={`/campaigns/${p.id}`} className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-white border border-border shadow-card hover:border-[#6C4DF6]/40 hover:shadow-hover transition-all group">
                  {/* Name + meta */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-ink-900 truncate group-hover:text-[#6C4DF6] transition-colors">{p.name}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="text-[12px] text-ink-400 mt-1 flex items-center gap-2 flex-wrap">
                      <span>Created {fmtDate(p.created_at)}</span>
                      <span className="text-ink-300">·</span>
                      <span className="text-ink-600">{p.recruit_count} creators</span>
                      <span className="text-ink-300">·</span>
                      <span className="text-emerald-700">{p.recruited_count} confirmed</span>
                    </div>
                  </div>
                  {/* Budget / spend */}
                  <div className="hidden sm:block w-44 shrink-0">
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className={over ? 'text-rose-600 font-medium' : 'text-ink-700 font-medium'}>{inr(spent)}</span>
                      <span className="text-ink-400">{budget > 0 ? `of ${inr(budget)}` : 'no budget'}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#eef] overflow-hidden">
                      <div className="h-1.5 rounded-full" style={{ width: `${budget > 0 ? pct : 0}%`, background: over ? '#ef4444' : 'linear-gradient(90deg,#6C4DF6,#9b7bff)' }} />
                    </div>
                  </div>
                  {/* Chevron */}
                  <div className="shrink-0 text-ink-300 group-hover:text-[#6C4DF6] transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="px-5 py-4">
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#6C4DF6]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}{sub && <span className="ml-1.5 normal-case tracking-normal text-emerald-600">· {sub}</span>}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { t: string; c: string; b: string }> = {
    active: { t: 'Active', c: '#047857', b: '#ecfdf5' },
    paused: { t: 'Paused', c: '#b45309', b: '#fffbeb' },
    closed: { t: 'Closed', c: '#6b7280', b: '#f3f4f6' },
  };
  const s = map[status] ?? { t: status, c: '#6b7280', b: '#f3f4f6' };
  return <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ color: s.c, background: s.b }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: s.c }} />{s.t}</span>;
}
