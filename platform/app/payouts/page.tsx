'use client';

import { useEffect, useMemo, useState } from 'react';
import { MarketingNav, ACCENT } from '@/components/marketing';

interface PayoutMethod {
  id: string;
  label: string;
  type: 'upi' | 'bank' | 'paypal' | 'other';
  detail: string | null;
  is_default: boolean;
}

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
  payout_upi: string | null;
}

const num = (v: number | string | null): number => (v == null ? 0 : Number(v) || 0);
const inr = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');

// Build a UPI intent link. Tapping it opens the user's own UPI app (Google Pay /
// PhonePe / Paytm) pre-filled — the user authorises the payment themselves.
function upiLink(row: PayoutRow): string | null {
  const vpa = (row.payout_upi ?? '').trim();
  if (!vpa) return null;
  const params = new URLSearchParams({ pa: vpa, pn: row.display_name ?? row.handle, cu: 'INR', tn: `${row.program_name} payout` });
  if (row.rate != null && num(row.rate) > 0) params.set('am', String(num(row.rate)));
  return `upi://pay?${params.toString()}`;
}

const TYPE_LABEL: Record<string, string> = { upi: 'UPI', bank: 'Bank transfer', paypal: 'PayPal', other: 'Other' };

export default function PayoutsPage() {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('all');
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [adding, setAdding] = useState(false);
  const [mForm, setMForm] = useState<{ label: string; type: PayoutMethod['type']; detail: string }>({ label: '', type: 'upi', detail: '' });
  const [mBusy, setMBusy] = useState(false);

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
  async function loadMethods() {
    const d = await fetch('/api/payout-methods').then((r) => r.json()).catch(() => ({}));
    setMethods(d.methods ?? []);
  }
  useEffect(() => {
    void load();
    void loadMethods();
  }, []);

  async function addMethod() {
    if (mForm.label.trim().length < 2) return;
    setMBusy(true);
    try {
      const r = await fetch('/api/payout-methods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mForm) });
      if (r.ok) { setMForm({ label: '', type: 'upi', detail: '' }); setAdding(false); await loadMethods(); }
    } finally {
      setMBusy(false);
    }
  }
  async function removeMethod(id: string) {
    if (!confirm('Remove this payout method?')) return;
    setMethods((ms) => ms.filter((m) => m.id !== id));
    await fetch(`/api/payout-methods/${id}`, { method: 'DELETE' }).catch(() => loadMethods());
    loadMethods();
  }
  async function makeDefault(id: string) {
    setMethods((ms) => ms.map((m) => ({ ...m, is_default: m.id === id })));
    await fetch(`/api/payout-methods/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }) }).catch(() => loadMethods());
  }

  async function setPaid(row: PayoutRow, paid: boolean) {
    setRows((rs) => rs.map((r) => (r.creator_id === row.creator_id && r.program_id === row.program_id ? { ...r, paid, paid_at: paid ? new Date().toISOString() : null } : r)));
    await fetch(`/api/programs/${row.program_id}/recruits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: row.creator_id, paid }),
    }).catch(() => load());
  }

  async function setUpi(row: PayoutRow, payout_upi: string) {
    const v = payout_upi.trim() || null;
    if (v === (row.payout_upi ?? null)) return;
    setRows((rs) => rs.map((r) => (r.creator_id === row.creator_id && r.program_id === row.program_id ? { ...r, payout_upi: v } : r)));
    await fetch(`/api/programs/${row.program_id}/recruits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: row.creator_id, payout_upi: v }),
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

        {/* Payout methods */}
        <div className="rounded-2xl bg-white border border-border shadow-card p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[13px] font-semibold text-ink-900">Payout methods</div>
              <div className="text-[12px] text-ink-400">How you pay creators. Add or remove your options.</div>
            </div>
            {!adding && <button onClick={() => setAdding(true)} className="px-3.5 py-2 text-[13px] font-semibold text-white rounded-lg" style={{ background: ACCENT }}>+ Add method</button>}
          </div>

          {adding && (
            <div className="mb-3 p-3 rounded-xl border border-border bg-[#faf9ff] grid sm:grid-cols-[1.2fr_0.9fr_1.4fr_auto] gap-2 items-center">
              <input value={mForm.label} onChange={(e) => setMForm((f) => ({ ...f, label: e.target.value }))} placeholder="Label (e.g. Razorpay UPI)" className={minp} autoFocus />
              <select value={mForm.type} onChange={(e) => setMForm((f) => ({ ...f, type: e.target.value as PayoutMethod['type'] }))} className={minp}>
                {(['upi', 'bank', 'paypal', 'other'] as const).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
              <input value={mForm.detail} onChange={(e) => setMForm((f) => ({ ...f, detail: e.target.value }))} placeholder="Detail (e.g. brand@upi · optional)" className={minp} />
              <div className="flex gap-2">
                <button onClick={addMethod} disabled={mBusy || mForm.label.trim().length < 2} className="px-3 py-2 text-[13px] font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50">{mBusy ? '…' : 'Save'}</button>
                <button onClick={() => setAdding(false)} className="px-2 py-2 text-[13px] text-ink-500 hover:text-ink-900">Cancel</button>
              </div>
            </div>
          )}

          {methods.length === 0 ? (
            <div className="text-[13px] text-ink-400 py-3">No payout methods yet. Add one to record how creators get paid.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {methods.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-xl border border-border bg-white">
                  <span className="w-7 h-7 rounded-lg grid place-items-center text-[11px] font-bold" style={{ background: '#f4f2ff', color: ACCENT }}>{m.type.toUpperCase().slice(0, 2)}</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink-900 flex items-center gap-1.5">
                      {m.label}
                      {m.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Default</span>}
                    </div>
                    <div className="text-[11px] text-ink-400">{TYPE_LABEL[m.type]}{m.detail ? ` · ${m.detail}` : ''}</div>
                  </div>
                  {!m.is_default && <button onClick={() => makeDefault(m.id)} className="text-[11px] text-ink-400 hover:text-[#6C4DF6] px-1">Set default</button>}
                  <button onClick={() => removeMethod(m.id)} title="Remove" className="w-6 h-6 grid place-items-center rounded-md text-ink-300 hover:text-rose-600 hover:bg-rose-50">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && rows.length > 0 && (
          <div className="flex gap-1 p-1 rounded-lg bg-white border border-border w-max mb-4">
            {(['all', 'pending', 'paid'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-[13px] capitalize ${filter === f ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'}`}>{f}</button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">
            No payouts yet. Set creator rates on a campaign and they’ll appear here.
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
            <div className="hidden md:grid grid-cols-[1.3fr_1fr_0.7fr_1.1fr_1.5fr] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-ink-400 border-b border-border">
              <span>Creator</span><span>Campaign</span><span>Rate</span><span>Creator UPI</span><span>Payment</span>
            </div>
            {visible.map((r) => {
              const link = upiLink(r);
              return (
                <div key={`${r.program_id}-${r.creator_id}`} className="grid grid-cols-2 md:grid-cols-[1.3fr_1fr_0.7fr_1.1fr_1.5fr] gap-3 px-4 py-3 items-center border-b border-border-soft last:border-0 text-[13px]">
                  <a href={r.profile_url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 hover:text-ink-600 truncate">{r.display_name ?? `@${r.handle}`}</a>
                  <span className="text-ink-600 truncate">{r.program_name}</span>
                  <span className="font-semibold tabular-nums text-ink-900">{r.rate != null ? inr(num(r.rate)) : '—'}</span>
                  <input
                    defaultValue={r.payout_upi ?? ''}
                    onBlur={(e) => setUpi(r, e.target.value)}
                    placeholder="creator@upi"
                    className="px-2.5 py-1.5 border border-border bg-white text-[12px] text-ink-900 rounded-lg focus:outline-none focus:border-ink-900 min-w-0"
                  />
                  <div className="flex items-center gap-2 col-span-2 md:col-span-1">
                    {link ? (
                      <a
                        href={link}
                        onClick={(e) => { if (!confirm(`Open your UPI app to pay ${inr(num(r.rate))} to ${r.payout_upi}? You’ll confirm the payment in the app.`)) e.preventDefault(); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white rounded-lg hover:brightness-105"
                        style={{ background: 'linear-gradient(135deg,#1a73e8,#34a853)' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7h20v10H2zM2 11h20" /></svg>
                        Pay via UPI
                      </a>
                    ) : (
                      <span className="text-[11px] text-ink-300">Add UPI to pay</span>
                    )}
                    {r.paid ? (
                      <button onClick={() => setPaid(r, false)} className="px-3 py-1.5 text-[12px] rounded-lg text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100">✓ Paid</button>
                    ) : (
                      <button onClick={() => setPaid(r, true)} disabled={r.rate == null} className="px-3 py-1.5 text-[12px] rounded-lg text-white bg-ink-900 hover:bg-ink-800 disabled:opacity-40">Mark paid</button>
                    )}
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-400">Nothing {filter}.</div>}
          </div>
        )}
      </main>
    </div>
  );
}

const minp = 'w-full px-3 py-2 border border-border bg-white text-[13px] text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
function Summary({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: 'green' }) {
  const color = tone === 'green' ? 'text-emerald-700' : accent ? 'text-[#6C4DF6]' : 'text-ink-900';
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
