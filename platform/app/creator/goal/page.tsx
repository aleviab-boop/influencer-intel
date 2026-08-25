'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

interface GoalProgress {
  available: boolean;
  has_goal: boolean;
  goal: number;
  earned: number;
  pending: number;
  progress_pct: number;
  remaining: number;
  covered_by_pending: boolean;
  projected: number;
  projected_pct: number;
  status: 'hit' | 'ahead' | 'on-track' | 'behind' | 'no-goal';
  days_left: number;
  per_day_needed: number;
  headline: string;
  tip: string;
}

const money = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
const STATUS_C: Record<GoalProgress['status'], string> = {
  hit: '#16a34a', ahead: '#16a34a', 'on-track': ACCENT, behind: '#d97706', 'no-goal': '#94a3b8',
};
const STATUS_LABEL: Record<GoalProgress['status'], string> = {
  hit: 'Goal hit', ahead: 'Ahead of pace', 'on-track': 'On track', behind: 'Behind pace', 'no-goal': 'No goal set',
};
const PRESETS = [25000, 50000, 100000, 200000];

export default function GoalPage() {
  return (
    <Suspense fallback={null}>
      <Goal />
    </Suspense>
  );
}

function Goal() {
  const [handle, setHandle] = useState<string | null>(null);
  const [qs, setQs] = useState('');
  const [data, setData] = useState<GoalProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    const query = h ? `?handle=${encodeURIComponent(h.replace(/^@/, ''))}` : '';
    setQs(query);
    fetch(`/api/creator/goal${query}`)
      .then((r) => r.json())
      .then((d: GoalProgress) => { setData(d); if (d.has_goal) setInput(String(d.goal)); else setEditing(true); })
      .catch(() => setData({ available: false } as GoalProgress))
      .finally(() => setLoading(false));
  }, []);

  const save = async (value: number): Promise<void> => {
    setSaving(true);
    try {
      const res = await fetch(`/api/creator/goal${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_goal: value }),
      });
      const d = (await res.json()) as GoalProgress;
      if (d.available) { setData(d); setInput(d.goal ? String(d.goal) : ''); setEditing(false); }
    } catch {
      /* retry */
    } finally {
      setSaving(false);
    }
  };

  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator';
  const r = 52, circ = 2 * Math.PI * r;
  const shown = Math.min(100, data?.progress_pct ?? 0);
  const statusC = data ? STATUS_C[data.status] : ACCENT;

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1 max-w-xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors duration-200 mb-5">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ink-900">Monthly earnings goal</h1>
        <p className="mt-1.5 text-[14px] text-ink-600">Set a target and see whether your deal pipeline is pacing to hit it.</p>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <h2 className="text-[16px] font-semibold text-ink-900">Profile not found</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500">Open the portal with your handle to set an earnings goal.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {data.has_goal && !editing && (
              <>
                {/* Progress dial */}
                <div className="rounded-2xl bg-white border border-border shadow-card p-6 flex items-center gap-6">
                  <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
                    <svg width="128" height="128" viewBox="0 0 128 128">
                      <circle cx="64" cy="64" r={r} fill="none" stroke="#eee9fb" strokeWidth="12" />
                      <circle cx="64" cy="64" r={r} fill="none" stroke={statusC} strokeWidth="12" strokeLinecap="round"
                        strokeDasharray={`${(shown / 100) * circ} ${circ}`} transform="rotate(-90 64 64)" />
                    </svg>
                    <div className="absolute inset-0 grid place-items-center">
                      <div className="text-center">
                        <div className="text-[26px] font-bold tabular-nums leading-none" style={{ color: statusC }}>{data.progress_pct}%</div>
                        <div className="text-[10px] uppercase tracking-wide text-ink-400 mt-1">of goal</div>
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mb-1.5" style={{ color: statusC, background: `${statusC}14` }}>
                      {STATUS_LABEL[data.status]}
                    </span>
                    <div className="text-[15px] font-bold text-ink-900 leading-snug">{data.headline}</div>
                    <div className="text-[12.5px] text-ink-500 mt-1">{data.days_left} day{data.days_left === 1 ? '' : 's'} left this month</div>
                  </div>
                </div>

                {/* Breakdown tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Tile label="Goal" value={money(data.goal)} />
                  <Tile label="Earned" value={money(data.earned)} accent />
                  <Tile label="Pending" value={money(data.pending)} />
                  <Tile label="Projected" value={money(data.projected)} />
                </div>

                {/* Tip */}
                <div className="rounded-2xl p-4 text-[13px] text-ink-700" style={{ background: data.status === 'behind' ? '#fffbeb' : ACCENT_SOFT }}>
                  <span className="font-semibold" style={{ color: data.status === 'behind' ? '#d97706' : ACCENT }}>Do this · </span>
                  {data.tip}
                </div>

                <div className="flex items-center gap-4">
                  <button onClick={() => setEditing(true)} className="text-[13px] font-semibold" style={{ color: ACCENT }}>
                    Change goal
                  </button>
                  <Link href={`/creator/statement${qs}`} className="text-[13px] font-semibold text-ink-500 hover:text-ink-800 inline-flex items-center gap-1">
                    Earnings statement
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                  </Link>
                </div>
              </>
            )}

            {(editing || !data.has_goal) && (
              <div className="rounded-2xl bg-white border border-border shadow-card p-5">
                <label className="block text-[13px] font-semibold text-ink-800 mb-1.5">Your monthly target (₹)</label>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  placeholder="e.g. 50000"
                  className="w-full rounded-lg border border-border px-3 py-2.5 text-[15px] text-ink-900 tabular-nums focus:outline-none focus:border-[#b9aef0]"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button key={p} onClick={() => setInput(String(p))}
                      className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-border text-ink-600 hover:bg-[#faf9ff]">
                      {money(p)}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button onClick={() => save(Number(input) || 0)} disabled={saving || !input}
                    className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5 disabled:opacity-60"
                    style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                    {saving ? 'Saving…' : 'Set goal'}
                  </button>
                  {data.has_goal && (
                    <button onClick={() => { setEditing(false); setInput(String(data.goal)); }} className="text-[13px] font-semibold text-ink-500">Cancel</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-white shadow-card px-4 py-3.5">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 text-[16px] font-bold tabular-nums leading-none" style={accent ? { color: ACCENT } : undefined}>{value}</div>
    </div>
  );
}
