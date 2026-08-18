'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ACCENT } from '@/components/marketing';

// Shared campaign (program) detail body. Rendered by BOTH the public
// /campaigns/[id] route and the admin /admin/campaigns/[id] route so the two
// stay in sync — the only difference is the surrounding chrome and where the
// "back" link / post-delete redirect points (backHref).

type RecruitStatus = 'applied' | 'invited' | 'contacted' | 'recruited' | 'declined';
const PIPELINE: RecruitStatus[] = ['applied', 'invited', 'contacted', 'recruited', 'declined'];
const STAGE: Record<RecruitStatus, { label: string; dot: string; tint: string; ring: string }> = {
  applied: { label: 'Applied', dot: '#6C4DF6', tint: '#f6f4ff', ring: '#c9bdfb' },
  invited: { label: 'Invited', dot: '#94a3b8', tint: '#f8fafc', ring: '#cbd5e1' },
  contacted: { label: 'Contacted', dot: '#0ea5e9', tint: '#f0f9ff', ring: '#bae6fd' },
  recruited: { label: 'Recruited', dot: '#10b981', tint: '#f0fdf4', ring: '#a7f3d0' },
  declined: { label: 'Declined', dot: '#f43f5e', tint: '#fff1f2', ring: '#fecdd3' },
};
const STATUS_COLOR: Record<string, string> = { active: '#10b981', paused: '#f59e0b', closed: '#94a3b8' };

interface Program {
  id: string;
  name: string;
  status: string;
  source_prompt: string | null;
  description: string | null;
  requirements: string | null;
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

export function CampaignDetail({ id, backHref }: { id: string; backHref: string }) {
  const router = useRouter();
  const [program, setProgram] = useState<Program | null>(null);
  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<RecruitStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function deleteCampaign() {
    if (!program) return;
    if (!confirm(`Delete “${program.name}” and all its recruits? This can't be undone.`)) return;
    setDeleting(true);
    const r = await fetch(`/api/programs/${id}`, { method: 'DELETE' });
    if (r.ok) router.push(backHref);
    else { setDeleting(false); alert('Failed to delete campaign.'); }
  }

  // Export the shortlist to CSV (handle, name, followers, status, deal terms) so
  // it can go into a sheet / be shared with a brand.
  function exportCsv() {
    if (recruits.length === 0) return;
    const cols = ['handle', 'name', 'followers', 'status', 'quality', 'genre', 'region', 'deliverables', 'due_date', 'rate', 'profile_url'];
    const esc = (v: unknown) => {
      const s = String(v ?? '').replace(/[\r\n]+/g, ' ');
      return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = recruits.map((r) => [
      r.handle, r.display_name ?? '', num(r.follower_count), r.status,
      r.quality_score ?? '', r.genre ?? '', r.region ?? '',
      r.deliverables ?? '', r.due_date ?? '', num(r.rate) || '', r.profile_url,
    ].map(esc).join(','));
    const csv = [cols.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(program?.name ?? 'campaign').replace(/[^\w.-]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Copy all still-in-play (non-declined) creators' @handles for outreach.
  async function copyHandles() {
    const hs = recruits.filter((r) => r.status !== 'declined').map((r) => `@${r.handle}`);
    if (hs.length === 0) return;
    try {
      await navigator.clipboard.writeText(hs.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
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
  async function removeRecruit(creatorId: string) {
    // Optimistically drop the card; the DELETE removes the program_recruits row.
    // The creator itself stays in the DB (and in any other campaigns).
    setRecruits((rs) => rs.filter((r) => r.creator_id !== creatorId));
    await fetch(`/api/programs/${id}/recruits`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: creatorId }),
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
    <>
      <Link href={backHref} className="text-sm text-ink-600 hover:text-ink-900">← Campaigns</Link>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
        </div>
      ) : error ? (
        <div className="py-16 text-center text-sm text-rose-700">{error}</div>
      ) : program ? (
        <>
          {/* hero card — header + brief + requirements */}
          <div className="mt-3 rounded-2xl border border-border bg-white shadow-card overflow-hidden transition-shadow hover:shadow-hover">
            <div className="relative p-5" style={{ background: 'linear-gradient(135deg,#f7f4ff 0%,#ffffff 55%)' }}>
              {/* blurred radial glow */}
              <div
                aria-hidden
                className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full opacity-60 blur-3xl"
                style={{ background: 'radial-gradient(circle,rgba(108,77,246,0.22),transparent 70%)' }}
              />
              <div className="relative flex items-center gap-3 flex-wrap">
                <input
                  defaultValue={program.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== program.name && patchProgram({ name: e.target.value.trim() })}
                  className="text-2xl font-bold text-ink-900 bg-transparent border-b border-transparent hover:border-border focus:border-ink-900 focus:outline-none min-w-[200px]"
                />
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/80 backdrop-blur pl-2.5 pr-1 py-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[program.status] ?? '#94a3b8' }} />
                  <select
                    value={program.status}
                    onChange={(e) => patchProgram({ status: e.target.value })}
                    className="text-[12px] bg-transparent text-ink-700 focus:outline-none cursor-pointer pr-0.5"
                  >
                    {['active', 'paused', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Link
                    href={`/campaigns/${encodeURIComponent(id)}/submissions`}
                    title="Review the live post links creators have submitted"
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg px-3 py-1.5 border hover:-translate-y-px transition-all"
                    style={{ color: ACCENT, borderColor: '#d9d4f5', background: '#faf9ff' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                    Review deliverables
                  </Link>
                  <button
                    onClick={copyHandles}
                    disabled={recruits.length === 0}
                    title="Copy all shortlisted @handles for outreach"
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600 rounded-lg border border-border bg-white px-3 py-1.5 hover:text-ink-900 hover:border-ink-300 hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0 transition-all"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    {copied ? 'Copied!' : 'Copy handles'}
                  </button>
                  <button
                    onClick={exportCsv}
                    disabled={recruits.length === 0}
                    title="Download the shortlist as a CSV"
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600 rounded-lg border border-border bg-white px-3 py-1.5 hover:text-ink-900 hover:border-ink-300 hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0 transition-all"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                    Export CSV
                  </button>
                  <button
                    onClick={deleteCampaign}
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-400 rounded-lg border border-border bg-white px-3 py-1.5 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 hover:-translate-y-px disabled:opacity-50 disabled:hover:translate-y-0 transition-all"
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
              <input
                defaultValue={program.description ?? ''}
                onBlur={(e) => e.target.value !== (program.description ?? '') && patchProgram({ description: e.target.value.trim() || null })}
                placeholder="Add a short brief / goal…"
                className="relative mt-2 w-full max-w-2xl text-sm text-ink-600 bg-transparent border-b border-transparent hover:border-border focus:border-ink-900 focus:outline-none py-0.5"
              />
              {program.source_prompt && <p className="relative text-[12px] text-ink-400 mt-1">Seeded from “{program.source_prompt}”</p>}
            </div>

            {/* requirements */}
            <div className="border-t border-border-soft p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">Requirements</div>
              <textarea
                defaultValue={program.requirements ?? ''}
                onBlur={(e) => e.target.value !== (program.requirements ?? '') && patchProgram({ requirements: e.target.value.trim() || null })}
                rows={2}
                placeholder="Who & what you need — followers range, ER, niche, cities, deliverables, timeline…"
                className="w-full max-w-2xl text-sm text-ink-700 bg-[#faf9ff] border border-border rounded-xl px-3 py-2 focus:outline-none focus:border-ink-900 focus:bg-white transition-colors resize-none"
              />
            </div>
          </div>

          {/* summary stats */}
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Recruits" value={String(recruits.length)} />
            <Stat label="With deliverables" value={`${withDeliverables}/${recruits.length}`} />
            <Stat label="Spend" value={inr(spent)} accent />
            <Stat label="Avg quality" value={avgQual ? String(avgQual) : '—'} />
          </div>

          {/* budget */}
          <div className="mt-4 p-4 rounded-2xl bg-white border border-border shadow-card max-w-2xl transition-shadow hover:shadow-hover">
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

          {/* kanban — equal-height lanes that scroll internally */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
                  className="flex flex-col rounded-2xl border bg-white overflow-hidden transition-all duration-200"
                  style={{
                    borderColor: isOver ? s.ring : 'var(--ii-border, #ececf2)',
                    boxShadow: isOver ? `0 0 0 3px ${s.tint}, 0 10px 28px rgba(0,0,0,.07)` : '0 1px 2px rgba(0,0,0,.04)',
                    transform: isOver ? 'translateY(-3px)' : 'none',
                  }}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--ii-border-soft, #f0f0f5)', background: s.tint }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: s.dot }} />
                    <span className="text-[12px] font-semibold" style={{ color: s.dot }}>{s.label}</span>
                    <span className="ml-auto text-[11px] tabular-nums font-semibold text-ink-600 bg-white rounded-full px-2 py-0.5 border border-border-soft min-w-[26px] text-center">{inStage.length}</span>
                  </div>
                  <div className="flex-1 p-2.5 space-y-2 overflow-y-auto min-h-[280px] max-h-[560px]">
                    {inStage.map((r) => (
                      <RecruitCard key={r.creator_id} r={r} onPatch={patchRecruit} onRemove={removeRecruit} />
                    ))}
                    {inStage.length === 0 && (
                      <Link
                        href="/admin/scraper"
                        title="Open the agency scraper to find creators"
                        className="group/drop h-full min-h-[240px] grid place-items-center rounded-xl border border-dashed transition-all hover:border-[#6C4DF6]/50 hover:bg-[#faf9ff]"
                        style={{
                          borderColor: isOver ? s.dot : 'var(--ii-border, #e2e2ea)',
                          background: isOver ? s.tint : undefined,
                        }}
                      >
                        <div className="flex flex-col items-center gap-1.5 text-center px-2">
                          <span
                            className="w-7 h-7 grid place-items-center rounded-full transition-colors group-hover/drop:bg-[#6C4DF6] group-hover/drop:text-white"
                            style={{ background: isOver ? s.dot : '#f3f3f8', color: isOver ? '#fff' : '#b8b8c4' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                          </span>
                          <span className="text-[11px] font-medium" style={{ color: isOver ? s.dot : '#b8b8c4' }}>
                            {isOver ? `Drop into ${s.label}` : 'Drop creators here'}
                          </span>
                          {!isOver && (
                            <span className="text-[10px] font-medium text-[#6C4DF6] opacity-0 transition-opacity group-hover/drop:opacity-100">
                              Find creators →
                            </span>
                          )}
                        </div>
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {recruits.length === 0 && (
            <div className="text-sm text-ink-400 py-10 text-center">
              No recruits yet. Find and add creators from the{' '}
              <Link href="/admin/scraper" className="text-ink-900 underline">agency finder</Link>.
            </div>
          )}
        </>
      ) : null}
    </>
  );
}


function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white border border-border p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-hover hover:border-[#6C4DF6]/30">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: accent ? 'linear-gradient(90deg,#6C4DF6,#9b7bff)' : 'linear-gradient(90deg,#c9bdfb,#e6dfff)' }}
      />
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#6C4DF6]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}

function RecruitCard({ r, onPatch, onRemove }: { r: Recruit; onPatch: (creatorId: string, patch: Partial<Recruit>) => void; onRemove: (creatorId: string) => void }) {
  const [deliverables, setDeliverables] = useState(r.deliverables ?? '');
  const [rate, setRate] = useState(r.rate == null ? '' : String(num(r.rate)));
  const initials = (r.display_name ?? r.handle).slice(0, 2).toUpperCase();
  let h = 0;
  for (let i = 0; i < r.handle.length; i++) h = (h * 31 + r.handle.charCodeAt(i)) >>> 0;

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', r.creator_id)}
      className="group/card p-3 rounded-xl bg-white border border-border shadow-card hover:shadow-hover hover:border-ink-900/20 hover:-translate-y-0.5 transition-all duration-200 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full grid place-items-center text-white text-[11px] font-bold shrink-0" style={{ background: `linear-gradient(135deg, hsl(${h % 360} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))` }}>{initials}</div>
        <div className="min-w-0 flex-1">
          <a href={r.profile_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-[13px] text-ink-900 hover:text-ink-600 truncate block">
            {r.display_name ?? `@${r.handle}`}
          </a>
          <div className="text-[11px] text-ink-500 truncate">{[r.genre, r.region].filter(Boolean).join(' · ') || r.platform}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={r.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={`Open @${r.handle} on Instagram`}
            className="w-7 h-7 grid place-items-center rounded-lg text-white hover:brightness-105 transition"
            style={{ background: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
          </a>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (confirm(`Remove @${r.handle} from this campaign?`)) onRemove(r.creator_id); }}
            title={`Remove @${r.handle} from this campaign`}
            className="w-7 h-7 grid place-items-center rounded-lg text-ink-300 hover:text-rose-600 hover:bg-rose-50 transition-colors opacity-0 group-hover/card:opacity-100 focus:opacity-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" /></svg>
          </button>
        </div>
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
