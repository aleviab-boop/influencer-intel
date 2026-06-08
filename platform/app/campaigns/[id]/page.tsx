'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MarketingNav, ACCENT } from '@/components/marketing';

type RecruitStatus = 'applied' | 'invited' | 'contacted' | 'recruited' | 'declined';
const PIPELINE: RecruitStatus[] = ['applied', 'invited', 'contacted', 'recruited', 'declined'];
const STAGE: Record<RecruitStatus, { label: string; dot: string; tint: string; ring: string }> = {
  applied: { label: 'Applied', dot: '#6C4DF6', tint: '#f6f4ff', ring: '#c9bdfb' },
  invited: { label: 'Invited', dot: '#94a3b8', tint: '#f8fafc', ring: '#cbd5e1' },
  contacted: { label: 'Contacted', dot: '#0ea5e9', tint: '#f0f9ff', ring: '#bae6fd' },
  recruited: { label: 'Recruited', dot: '#10b981', tint: '#f0fdf4', ring: '#a7f3d0' },
  declined: { label: 'Declined', dot: '#f43f5e', tint: '#fff1f2', ring: '#fecdd3' },
};

interface Program {
  id: string;
  name: string;
  status: string;
  source_prompt: string | null;
  description: string | null;
  budget: number | string | null;
  start_date: string | null;
  end_date: string | null;
}
interface Recruit {
  creator_id: string;
  status: RecruitStatus;
  handle: string;
  display_name: string | null;
  profile_url: string;
  follower_count: number | string | null;
  platform: string;
  genre: string | null;
  region: string | null;
  relevance_score: number | null;
  quality_score: number | null;
  deliverables: string | null;
  due_date: string | null;
  rate: number | string | null;
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v) || 0);
const inr = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
const kfmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [program, setProgram] = useState<Program | null>(null);
  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<RecruitStatus | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteCampaign() {
    if (!program) return;
    if (!confirm(`Delete “${program.name}” and all its recruits? This can't be undone.`)) return;
    setDeleting(true);
    const r = await fetch(`/api/programs/${id}`, { method: 'DELETE' });
    if (r.ok) router.push('/campaigns');
    else { setDeleting(false); alert('Failed to delete campaign.'); }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/programs/${id}`);
      const d = await r.json();
      if (!r.ok) setError(d.error ?? 'Failed to load campaign');
      else {
        setProgram(d.program);
        setRecruits(d.recruits ?? []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchRecruit(creatorId: string, patch: Partial<Recruit>) {
    setRecruits((rs) => rs.map((r) => (r.creator_id === creatorId ? { ...r, ...patch } : r)));
    await fetch(`/api/programs/${id}/recruits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: creatorId, ...patch }),
    }).catch(() => load());
  }
  async function patchProgram(patch: Partial<Program>) {
    setProgram((p) => (p ? { ...p, ...patch } : p));
    await fetch(`/api/programs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => load());
  }

  const spent = recruits.filter((r) => r.status !== 'declined').reduce((s, r) => s + num(r.rate), 0);
  const budget = num(program?.budget);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const over = budget > 0 && spent > budget;
  const withDeliverables = recruits.filter((r) => r.deliverables && r.deliverables.trim()).length;
  const quals = recruits.map((r) => num(r.quality_score)).filter((q) => q > 0);
  const avgQual = quals.length ? Math.round(quals.reduce((a, b) => a + b, 0) / quals.length) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <Link href="/campaigns" className="text-sm text-ink-600 hover:text-ink-900">← Campaigns</Link>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
          </div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-rose-700">{error}</div>
        ) : program ? (
          <>
            {/* header */}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <input
                defaultValue={program.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== program.name && patchProgram({ name: e.target.value.trim() })}
                className="text-2xl font-bold text-ink-900 bg-transparent border-b border-transparent hover:border-border focus:border-ink-900 focus:outline-none min-w-[200px]"
              />
              <select
                value={program.status}
                onChange={(e) => patchProgram({ status: e.target.value })}
                className="text-[12px] px-2.5 py-1 rounded-full border border-border bg-white text-ink-700 focus:outline-none focus:border-ink-900"
              >
                {['active', 'paused', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={deleteCampaign} disabled={deleting} className="ml-auto text-[13px] text-ink-400 hover:text-rose-600 disabled:opacity-50 transition-colors">{deleting ? 'Deleting…' : 'Delete campaign'}</button>
            </div>
            <input
              defaultValue={program.description ?? ''}
              onBlur={(e) => e.target.value !== (program.description ?? '') && patchProgram({ description: e.target.value.trim() || null })}
              placeholder="Add a short brief / goal…"
              className="mt-1 w-full max-w-2xl text-sm text-ink-600 bg-transparent border-b border-transparent hover:border-border focus:border-ink-900 focus:outline-none py-0.5"
            />
            {program.source_prompt && <p className="text-[12px] text-ink-400 mt-1">Seeded from “{program.source_prompt}”</p>}

            {/* summary stats */}
            <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Recruits" value={String(recruits.length)} />
              <Stat label="With deliverables" value={`${withDeliverables}/${recruits.length}`} />
              <Stat label="Spend" value={inr(spent)} accent />
              <Stat label="Avg quality" value={avgQual ? String(avgQual) : '—'} />
            </div>

            {/* budget */}
            <div className="mt-4 p-4 rounded-2xl bg-white border border-border shadow-card max-w-2xl">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-ink-600 font-medium">Budget</span>
                  <div className="flex items-center px-2 rounded-lg border border-border bg-white focus-within:border-ink-900">
                    <span className="text-ink-400 text-sm">₹</span>
                    <input type="number" defaultValue={budget || ''} onBlur={(e) => patchProgram({ budget: e.target.value.trim() === '' ? null : Number(e.target.value) })} placeholder="set budget" className="w-28 py-1 text-sm bg-transparent focus:outline-none" />
                  </div>
                </div>
                <div className="text-sm">
                  <span className={over ? 'text-rose-600 font-bold' : 'text-ink-900 font-bold'}>{inr(spent)}</span>
                  <span className="text-ink-400"> spent{budget > 0 && ` of ${inr(budget)}`}</span>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-[#eef] overflow-hidden">
                <div className="h-2.5 rounded-full transition-all duration-500" style={{ width: `${budget > 0 ? pct : 0}%`, background: over ? 'linear-gradient(90deg,#ef4444,#f87171)' : 'linear-gradient(90deg,#6C4DF6,#9b7bff)', boxShadow: budget > 0 ? '0 0 12px rgba(108,77,246,.45)' : 'none' }} />
              </div>
              {over && <div className="mt-1.5 text-[12px] text-rose-600">Over budget by {inr(spent - budget)}</div>}

              {/* schedule */}
              <div className="mt-4 pt-4 border-t border-border-soft flex items-center gap-4 flex-wrap text-sm">
                <span className="text-ink-600 font-medium">Schedule</span>
                <label className="flex items-center gap-1.5 text-[13px] text-ink-500">
                  Start
                  <input type="date" defaultValue={program.start_date ?? ''} onBlur={(e) => e.target.value !== (program.start_date ?? '') && patchProgram({ start_date: e.target.value || null })} className="px-2 py-1 border border-border rounded-lg bg-white text-ink-900 focus:outline-none focus:border-ink-900" />
                </label>
                <label className="flex items-center gap-1.5 text-[13px] text-ink-500">
                  End
                  <input type="date" defaultValue={program.end_date ?? ''} onBlur={(e) => e.target.value !== (program.end_date ?? '') && patchProgram({ end_date: e.target.value || null })} className="px-2 py-1 border border-border rounded-lg bg-white text-ink-900 focus:outline-none focus:border-ink-900" />
                </label>
              </div>
            </div>

            {/* invite */}
            <InviteCreators programId={id} existing={new Set(recruits.map((r) => r.creator_id))} onAdded={load} />

            {/* kanban */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              {PIPELINE.map((stage) => {
                const s = STAGE[stage];
                const inStage = recruits.filter((r) => r.status === stage);
                const isOver = dragOver === stage;
                return (
                  <div
                    key={stage}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(stage); }}
                    onDragLeave={() => setDragOver((d) => (d === stage ? null : d))}
                    onDrop={(e) => { e.preventDefault(); const cid = e.dataTransfer.getData('text/plain'); if (cid) patchRecruit(cid, { status: stage }); setDragOver(null); }}
                    className="rounded-2xl p-2.5 transition-colors"
                    style={{ background: isOver ? s.tint : '#f1f1f7', outline: isOver ? `2px dashed ${s.ring}` : 'none' }}
                  >
                    <div className="flex items-center gap-2 px-1.5 py-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: s.dot }} />
                      <span className="text-[12px] font-semibold text-ink-700">{s.label}</span>
                      <span className="ml-auto text-[11px] tabular-nums text-ink-400 bg-white rounded-full px-2 py-0.5">{inStage.length}</span>
                    </div>
                    <div className="space-y-2 min-h-[80px]">
                      {inStage.map((r) => (
                        <RecruitCard key={r.creator_id} r={r} onPatch={patchRecruit} />
                      ))}
                      {inStage.length === 0 && (
                        <div className="text-[11px] text-ink-300 text-center py-6 rounded-xl border border-dashed border-border">
                          Drop creators here
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {recruits.length === 0 && (
              <div className="text-sm text-ink-400 py-10 text-center">
                No recruits yet. Add influencers from{' '}
                <Link href="/lander" className="text-ink-900 underline">the home search</Link>.
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}

interface SearchCreator { id: string; handle: string; display_name: string | null; follower_count: number | string | null; primary_category: string | null }
function InviteCreators({ programId, existing, onAdded }: { programId: string; existing: Set<string>; onAdded: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchCreator[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/creators?q=${encodeURIComponent(q.trim())}&limit=6`)
        .then((r) => r.json())
        .then((d) => setResults(d.creators ?? []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function add(creatorId: string) {
    setAdding(creatorId);
    try {
      await fetch(`/api/programs/${programId}/recruits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creator_id: creatorId }) });
      setQ(''); setResults([]); setOpen(false);
      onAdded();
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="mt-6 relative max-w-md" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Invite creators</div>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search creators by handle or name…" className="w-full pl-9 pr-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-ink-900" />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl bg-white border border-border shadow-[0_12px_40px_rgba(0,0,0,0.12)] overflow-hidden">
          {results.map((c) => {
            const added = existing.has(c.id);
            return (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-soft last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink-900 truncate">{c.display_name || `@${c.handle}`}</div>
                  <div className="text-[11px] text-ink-400 truncate">@{c.handle} · {kfmt(Number(c.follower_count) || 0)}{c.primary_category ? ` · ${c.primary_category}` : ''}</div>
                </div>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => add(c.id)} disabled={added || adding === c.id} className="px-3 py-1.5 text-[12px] font-semibold rounded-lg disabled:opacity-60" style={{ color: added ? '#6b7280' : '#fff', background: added ? '#f3f4f6' : ACCENT }}>
                  {added ? 'Added' : adding === c.id ? '…' : 'Invite'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-border p-3.5 shadow-card">
      <div className={`text-xl font-bold tabular-nums ${accent ? 'text-[#6C4DF6]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}

function RecruitCard({ r, onPatch }: { r: Recruit; onPatch: (creatorId: string, patch: Partial<Recruit>) => void }) {
  const [deliverables, setDeliverables] = useState(r.deliverables ?? '');
  const [rate, setRate] = useState(r.rate == null ? '' : String(num(r.rate)));
  const initials = (r.display_name ?? r.handle).slice(0, 2).toUpperCase();
  let h = 0;
  for (let i = 0; i < r.handle.length; i++) h = (h * 31 + r.handle.charCodeAt(i)) >>> 0;

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', r.creator_id)}
      className="p-3 rounded-xl bg-white border border-border shadow-card hover:shadow-hover hover:border-ink-900/20 transition-all cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full grid place-items-center text-white text-[11px] font-bold shrink-0" style={{ background: `linear-gradient(135deg, hsl(${h % 360} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))` }}>{initials}</div>
        <div className="min-w-0 flex-1">
          <a href={r.profile_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-[13px] text-ink-900 hover:text-ink-600 truncate block">
            {r.display_name ?? `@${r.handle}`}
          </a>
          <div className="text-[11px] text-ink-500 truncate">{[r.genre, r.region].filter(Boolean).join(' · ') || r.platform}</div>
        </div>
        <a
          href={r.profile_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Open @${r.handle} on Instagram`}
          className="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-white hover:brightness-105 transition"
          style={{ background: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
        </a>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[10px]">
        {r.follower_count != null && <Chip>{kfmt(num(r.follower_count))}</Chip>}
        {r.quality_score !== null && <Chip tone={num(r.quality_score) >= 80 ? 'green' : 'amber'}>Q {Math.round(num(r.quality_score))}</Chip>}
      </div>

      <div className="mt-2.5 space-y-1.5 pt-2.5 border-t border-border-soft">
        <input
          value={deliverables}
          onChange={(e) => setDeliverables(e.target.value)}
          onBlur={() => deliverables !== (r.deliverables ?? '') && onPatch(r.creator_id, { deliverables: deliverables || null })}
          placeholder="Deliverables…"
          className="w-full px-2 py-1 border border-border bg-white text-[11px] text-ink-900 rounded-md focus:outline-none focus:border-ink-900"
        />
        <div className="flex gap-1.5">
          <input
            type="date"
            value={(r.due_date ?? '').slice(0, 10)}
            onChange={(e) => onPatch(r.creator_id, { due_date: e.target.value || null })}
            className="flex-1 min-w-0 px-1.5 py-1 border border-border bg-white text-[11px] text-ink-700 rounded-md focus:outline-none focus:border-ink-900"
          />
          <div className="flex items-center w-[78px] px-1.5 border border-border bg-white rounded-md focus-within:border-ink-900">
            <span className="text-[11px] text-ink-400">₹</span>
            <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={() => onPatch(r.creator_id, { rate: rate.trim() === '' ? null : Number(rate) })} placeholder="rate" className="w-full py-1 text-[11px] text-ink-900 bg-transparent focus:outline-none" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'green' | 'amber' }) {
  const cls = tone === 'green' ? 'text-emerald-700 bg-emerald-50' : tone === 'amber' ? 'text-amber-700 bg-amber-50' : 'text-ink-600 bg-[#f2f2f7]';
  return <span className={`px-1.5 py-0.5 rounded-md tabular-nums ${cls}`}>{children}</span>;
}
