'use client';

import { useEffect, useMemo, useState } from 'react';
import { MarketingNav } from '@/components/marketing';

interface PayoutRow {
  program_id: string;
  program_name: string;
  creator_id: string;
  handle: string;
  display_name: string | null;
  profile_url: string;
  status: string;
  rate: number | string | null;
  deliverables: string | null;
  due_date: string | null;
  paid: boolean;
  paid_at: string | null;
}

const num = (v: number | string | null): number => (v == null ? 0 : Number(v) || 0);
const inr = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');

export default function PayoutsPage() {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('all');

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/payouts');
      const d = await r.json();
      setRows(d.payouts ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function setPaid(row: PayoutRow, paid: boolean) {
    setRows((rs) => rs.map((r) => (r.creator_id === row.creator_id && r.program_id === row.program_id ? { ...r, paid, paid_at: paid ? new Date().toISOString() : null } : r)));
    await fetch(`/api/programs/${row.program_id}/recruits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: row.creator_id, paid }),
    }).catch(() => load());
  }

  const committed = useMemo(() => rows.reduce((s, r) => s + num(r.rate), 0), [rows]);
  const paid = useMemo(() => rows.filter((r) => r.paid).reduce((s, r) => s + num(r.rate), 0), [rows]);
  const pending = committed - paid;
  const visible = rows.filter((r) => (filter === 'pending' ? !r.paid : filter === 'paid' ? r.paid : true));

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Influencer Payouts</div>
        <h1 className="text-2xl font-bold text-ink-900 mb-6">Payouts</h1>

        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Summary label="Committed" value={inr(committed)} />
            <Summary label="Paid" value={inr(paid)} tone="green" />
            <Summary label="Pending" value={inr(pending)} accent />
            <Summary label="Creators" value={String(rows.length)} />
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="flex gap-1 p-1 rounded-lg bg-white border border-border w-max mb-4">
            {(['all', 'pending', 'paid'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-[13px] capitalize ${filter === f ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'}`}>{f}</button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-[3px] border-[#FBE3DA] border-t-[#F2542D] animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">
            No payouts yet. Set creator rates on a campaign and they’ll appear here.
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
            <div className="hidden md:grid grid-cols-[1.4fr_1fr_1fr_0.8fr_0.8fr_auto] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-ink-400 border-b border-border">
              <span>Creator</span><span>Campaign</span><span>Deliverables</span><span>Due</span><span>Rate</span><span></span>
            </div>
            {visible.map((r) => (
              <div key={`${r.program_id}-${r.creator_id}`} className="grid grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_0.8fr_0.8fr_auto] gap-3 px-4 py-3 items-center border-b border-border-soft last:border-0 text-[13px]">
                <a href={r.profile_url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 hover:text-ink-600 truncate">{r.display_name ?? `@${r.handle}`}</a>
                <span className="text-ink-600 truncate">{r.program_name}</span>
                <span className="text-ink-500 truncate hidden md:block">{r.deliverables || '—'}</span>
                <span className="text-ink-500 hidden md:block">{r.due_date ? r.due_date.slice(0, 10) : '—'}</span>
                <span className="font-semibold tabular-nums text-ink-900">{r.rate != null ? inr(num(r.rate)) : '—'}</span>
                <div className="text-right">
                  {r.paid ? (
                    <button onClick={() => setPaid(r, false)} className="px-3 py-1.5 text-[12px] rounded-lg text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100">✓ Paid</button>
                  ) : (
                    <button onClick={() => setPaid(r, true)} disabled={r.rate == null} className="px-3 py-1.5 text-[12px] rounded-lg text-white bg-ink-900 hover:bg-ink-800 disabled:opacity-40">Mark paid</button>
                  )}
                </div>
              </div>
            ))}
            {visible.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-400">Nothing {filter}.</div>}
          </div>
        )}
      </main>
    </div>
  );
}

function Summary({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: 'green' }) {
  const color = tone === 'green' ? 'text-emerald-700' : accent ? 'text-[#F2542D]' : 'text-ink-900';
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
