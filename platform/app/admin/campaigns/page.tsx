'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StatCard, PageHeader } from '@/components/admin-ui';

interface ProgramSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  recruit_count: number;
  recruited_count: number;
  budget: number | string | null;
  spent: number | string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

const num = (v: number | string | null): number => (v == null ? 0 : Number(v) || 0);
const inr = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtDate = (s: string): string => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtShort = (s: string): string => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const fmtRange = (start: string | null, end: string | null): string | null => {
  if (start && end) return `Runs ${fmtShort(start)} – ${fmtShort(end)}`;
  if (start) return `Starts ${fmtShort(start)}`;
  if (end) return `Ends ${fmtShort(end)}`;
  return null;
};

const FILTERS = ['all', 'active', 'paused', 'closed'] as const;
type Filter = (typeof FILTERS)[number];

export default function AdminCampaignsPage() {
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', requirements: '', budget: '', start_date: '', end_date: '' });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

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
    if (form.name.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          requirements: form.requirements.trim() || undefined,
          budget: form.budget ? Number(form.budget) : undefined,
          start_date: form.start_date || undefined,
          end_date: form.end_date || undefined,
        }),
      });
      if (r.ok) { setForm({ name: '', description: '', requirements: '', budget: '', start_date: '', end_date: '' }); setCreating(false); await load(); }
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
    <div className="px-8 py-7">
      <PageHeader
        title="Campaigns"
        subtitle="Named recruitment campaigns. Shortlist creators from search into a campaign, then move them through the pipeline and track budget."
      />

      {/* metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-7">
        <StatCard label="Campaigns" value={programs.length} sub={`${activeCount} active`} />
        <StatCard label="Creators recruited" value={totalRecruited} color="#0ea5e9" />
        <StatCard label="Confirmed" value={totalConfirmed} color="#10b981" />
        <StatCard label="Committed spend" value={inr(totalSpend)} color="#f59e0b" />
      </div>

      {/* toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex gap-1 p-1 rounded-xl bg-white border border-[#ececf3] w-max shadow-[0_2px_16px_rgba(20,20,60,0.03)]">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-[13px] capitalize transition-colors ${filter === f ? 'bg-[#6C4DF6] text-white' : 'text-[#666] hover:text-[#111]'}`}>
              {f} <span className={filter === f ? 'text-white/70' : 'text-[#aab]'}>{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aab]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search campaigns…" className="pl-9 pr-3 py-2.5 border border-[#ececf3] bg-white text-sm text-[#111] rounded-xl focus:outline-none focus:border-[#6C4DF6] w-[200px]" />
          </div>
          <button onClick={() => setCreating((c) => !c)} className="px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-all hover:brightness-105" style={{ background: 'linear-gradient(135deg, #6C4DF6, #9b7bff)', boxShadow: '0 8px 20px rgba(108,77,246,0.28)' }}>+ New campaign</button>
        </div>
      </div>

      {/* create panel */}
      {creating && (
        <div className="mb-5 p-5 rounded-2xl bg-white border border-[#ececf3] shadow-[0_2px_16px_rgba(20,20,60,0.03)]">
          <div className="text-[13px] font-semibold text-[#111] mb-4">New campaign</div>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Campaign name" className="md:col-span-2">
              <input value={form.name} onChange={setF('name')} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus placeholder="e.g. Summer Goa 2026" className={cinp} />
            </Field>
            <Field label="Brief / goal (optional)" className="md:col-span-2">
              <textarea value={form.description} onChange={setF('description')} rows={2} placeholder="What's this campaign about? e.g. recruit 10 Goa travel micro-creators for reels" className={`${cinp} resize-none`} />
            </Field>
            <Field label="Requirements (optional)" className="md:col-span-2">
              <textarea value={form.requirements} onChange={setF('requirements')} rows={3} placeholder="Who & what you need — e.g. 50K–300K followers, ER 2%+, fashion/lifestyle, based in Delhi/Mumbai, 1 reel + 2 stories, deliver by 20th" className={`${cinp} resize-none`} />
            </Field>
            <Field label="Budget (₹, optional)">
              <input type="number" value={form.budget} onChange={setF('budget')} placeholder="500000" className={cinp} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date"><input type="date" value={form.start_date} onChange={setF('start_date')} className={cinp} /></Field>
              <Field label="End date"><input type="date" value={form.end_date} onChange={setF('end_date')} className={cinp} /></Field>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm text-[#666] hover:text-[#111]">Cancel</button>
            <button onClick={create} disabled={busy || form.name.trim().length < 2} className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #6C4DF6, #9b7bff)' }}>{busy ? 'Creating…' : 'Create campaign'}</button>
          </div>
        </div>
      )}

      {error && <div className="mb-4 text-sm text-rose-700">{error}</div>}

      {/* list */}
      {loading ? (
        <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
      ) : programs.length === 0 ? (
        <div className="text-sm text-[#aaa] py-20 text-center rounded-2xl border border-dashed border-[#ddd] bg-white">
          No campaigns yet. Recruit creators from <Link href="/admin/scraper" className="text-[#6C4DF6] underline">the scraper search</Link>, or create one above.
        </div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-[#aaa] py-16 text-center rounded-2xl border border-dashed border-[#ddd] bg-white">No campaigns match this filter.</div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((p) => {
            const budget = num(p.budget);
            const spent = num(p.spent);
            const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
            const over = budget > 0 && spent > budget;
            return (
              <Link key={p.id} href={`/admin/campaigns/${p.id}`} className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-white border border-[#ececf3] shadow-[0_2px_16px_rgba(20,20,60,0.03)] hover:border-[#d9d2f7] hover:shadow-[0_12px_32px_rgba(108,77,246,0.12)] transition-all group">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-semibold text-[#111] truncate group-hover:text-[#6C4DF6] transition-colors">{p.name}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-[12px] text-[#aab] mt-1 flex items-center gap-2 flex-wrap">
                    {fmtRange(p.start_date, p.end_date) ? (
                      <span className="inline-flex items-center gap-1 text-[#777] font-medium">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
                        {fmtRange(p.start_date, p.end_date)}
                      </span>
                    ) : (
                      <span>Created {fmtDate(p.created_at)}</span>
                    )}
                    <span className="text-[#ccc]">·</span>
                    <span className="text-[#777]">{p.recruit_count} creators</span>
                    <span className="text-[#ccc]">·</span>
                    <span className="text-emerald-700">{p.recruited_count} confirmed</span>
                  </div>
                </div>
                <div className="hidden sm:block w-44 shrink-0">
                  <div className="flex items-center justify-between text-[12px] mb-1">
                    <span className={over ? 'text-rose-600 font-medium' : 'text-[#444] font-medium'}>{inr(spent)}</span>
                    <span className="text-[#aab]">{budget > 0 ? `of ${inr(budget)}` : 'no budget'}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#eef] overflow-hidden">
                    <div className="h-1.5 rounded-full" style={{ width: `${budget > 0 ? pct : 0}%`, background: over ? '#ef4444' : 'linear-gradient(90deg,#6C4DF6,#9b7bff)' }} />
                  </div>
                </div>
                <div className="shrink-0 text-[#ccc] group-hover:text-[#6C4DF6] transition-colors">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const cinp = 'w-full px-3 py-2 border border-[#ececf3] bg-white text-sm text-[#111] rounded-lg focus:outline-none focus:border-[#6C4DF6]';
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className ?? ''}`}><span className="text-[12px] text-[#888] mb-1 block">{label}</span>{children}</label>;
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
