'use client';

import { useEffect, useState } from 'react';
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

export default function CampaignsPage() {
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

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
      if (r.ok) {
        setNewName('');
        setCreating(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  const totalRecruited = programs.reduce((s, p) => s + p.recruit_count, 0);
  const totalConfirmed = programs.reduce((s, p) => s + p.recruited_count, 0);
  const totalSpend = programs.reduce((s, p) => s + num(p.spent), 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Campaign Management</div>
            <h1 className="text-2xl font-bold text-ink-900">Your campaigns</h1>
          </div>
          <button onClick={() => setCreating((c) => !c)} className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800">
            + New campaign
          </button>
        </div>

        {/* summary */}
        {!loading && programs.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Summary label="Campaigns" value={String(programs.length)} />
            <Summary label="Recruited" value={String(totalRecruited)} />
            <Summary label="Confirmed" value={String(totalConfirmed)} />
            <Summary label="Total spend" value={inr(totalSpend)} accent />
          </div>
        )}

        {creating && (
          <div className="mb-6 flex items-center gap-2 p-4 rounded-xl bg-white border border-border shadow-card">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              autoFocus
              placeholder="Campaign name (e.g. Summer Goa 2026)"
              className="flex-1 px-3 py-2 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900"
            />
            <button onClick={create} disabled={busy || newName.trim().length < 2} className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50">
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        )}

        {error && <div className="mb-6 text-sm text-rose-700">{error}</div>}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-[3px] border-[#FBE3DA] border-t-[#F2542D] animate-spin" />
          </div>
        ) : programs.length === 0 ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">
            No campaigns yet. Recruit creators from{' '}
            <Link href="/lander" className="text-ink-900 underline">the home search</Link>, or create one above.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {programs.map((p) => {
              const budget = num(p.budget);
              const spent = num(p.spent);
              const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
              return (
                <Link key={p.id} href={`/campaigns/${p.id}`} className="group block p-5 rounded-2xl bg-white border border-border hover:border-[#F2542D]/40 hover:shadow-hover transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <span className="font-semibold text-ink-900 truncate group-hover:text-[#F2542D] transition-colors">{p.name}</span>
                    <StatusDot status={p.status} />
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                    <Pill>{p.recruit_count} recruited</Pill>
                    <Pill tone="green">{p.recruited_count} confirmed</Pill>
                  </div>
                  {budget > 0 ? (
                    <>
                      <div className="flex items-center justify-between text-[12px] text-ink-500 mb-1">
                        <span>{inr(spent)} spent</span>
                        <span>of {inr(budget)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#eef] overflow-hidden">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: spent > budget ? '#ef4444' : 'linear-gradient(90deg,#F2542D,#FF7A45)' }} />
                      </div>
                    </>
                  ) : (
                    <div className="text-[12px] text-ink-400">{spent > 0 ? `${inr(spent)} committed · no budget set` : 'No budget set'}</div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function Summary({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#F2542D]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'green' }) {
  const cls = tone === 'green' ? 'text-emerald-700 bg-emerald-50' : 'text-ink-700 bg-[#f2f2f7]';
  return <span className={`text-[12px] px-2 py-0.5 rounded-md ${cls}`}>{children}</span>;
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'active' ? 'bg-emerald-500' : status === 'paused' ? 'bg-amber-500' : 'bg-ink-300';
  return (
    <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-400 shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {status}
    </span>
  );
}
