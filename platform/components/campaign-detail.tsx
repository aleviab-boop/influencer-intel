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

// Pull follower / ER thresholds written in the search text into the filter
// controls, so "1M+ followers, ER > 2%" actually filters instead of being
// treated as plain keywords. Returns only the axes it actually found.
function parseFilters(text: string): { min?: number; max?: number; er?: number } {
  const t = ' ' + text.toLowerCase() + ' ';
  const out: { min?: number; max?: number; er?: number } = {};
  const toNum = (raw: string, suf: string): number => {
    let n = parseFloat(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) return NaN;
    const s = (suf || '').toLowerCase();
    if (s === 'm') n *= 1e6;
    else if (s === 'k') n *= 1e3;
    return Math.round(n);
  };

  // Engagement rate first — "er > 2%", "er - > 2%", "2%+ ER", "engagement 3%".
  const er1 = t.match(/(?:er|engagement(?:\s*rate)?)\s*[>≥:=\-\s]*(\d+(?:\.\d+)?)\s*%?/);
  const er2 = t.match(/(\d+(?:\.\d+)?)\s*%\s*\+?\s*(?:er|engagement)/);
  const erRaw = er1?.[1] ?? er2?.[1];
  if (erRaw != null) { const e = parseFloat(erRaw); if (Number.isFinite(e)) out.er = e; }

  // Strip ER phrases + any bare "N%" so their numbers don't leak into follower parsing.
  let ft = t;
  if (er1) ft = ft.replace(er1[0], ' ');
  if (er2) ft = ft.replace(er2[0], ' ');
  ft = ft.replace(/\d+(?:\.\d+)?\s*%/g, ' ');

  // Follower range — "50k-300k", "50k to 300k", "between 50k and 300k".
  const range = ft.match(/(\d[\d.,]*)\s*([km]?)\s*(?:-|–|—|to|and)\s*(\d[\d.,]*)\s*([km]?)/);
  if (range) {
    const a = toNum(range[1]!, range[2] || range[4] || '');
    const b = toNum(range[3]!, range[4] || '');
    if (a > 0 && b > 0) { out.min = Math.min(a, b); out.max = Math.max(a, b); return out; }
  }

  // Max — "under 100k", "below 50k", "up to 500k", "less than 1m", "max 100k", "< 10k".
  const mx = ft.match(/(?:under|below|less than|fewer than|up to|max(?:imum)?|<|≤)\s*(\d[\d.,]*)\s*([km]?)/);
  if (mx) { const n = toNum(mx[1]!, mx[2] || ''); if (n > 0) out.max = n; }

  // Min — "1m+", "over 100k", "at least 50k", "min 10k", "100k+ followers", "500k plus".
  const mn = ft.match(/(?:over|above|at least|more than|min(?:imum)?|from|>|≥)\s*(\d[\d.,]*)\s*([km]?)/)
          || ft.match(/(\d[\d.,]*)\s*([km]?)\s*(?:\+|plus)/)
          || ft.match(/(\d[\d.,]*)\s*([km])\s*(?:followers|fans|subs)/);
  if (mn) { const n = toNum(mn[1]!, mn[2] || ''); if (n > 0) out.min = n; }

  return out;
}

const trimNum = (x: number): string => (x % 1 === 0 ? String(x) : x.toFixed(1));
const followersPlus = (n: number): string =>
  n >= 1e6 ? `${trimNum(n / 1e6)}M+` : n >= 1e3 ? `${trimNum(n / 1e3)}K+` : `${n}+`;
const followersUnder = (n: number): string =>
  n >= 1e6 ? `Under ${trimNum(n / 1e6)}M` : n >= 1e3 ? `Under ${trimNum(n / 1e3)}K` : `Under ${n}`;
// Fixed dropdown option list, plus the current value if a typed threshold
// produced something off-list (e.g. 50K / 300K) so the <select> can still show it.
const withValue = (base: number[], v: number): number[] =>
  base.includes(v) ? base : [...base, v].sort((a, b) => a - b);
const MIN_FOLLOWER_OPTS = [0, 1000, 5000, 10000, 100000, 1000000];
const MAX_FOLLOWER_OPTS = [0, 10000, 50000, 100000, 500000, 1000000];
const MIN_ER_OPTS = [0, 1, 2, 3, 5, 8];

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

          {/* find & add creators by brief (scrapes + DB), then quick handle add */}
          <FindCreators
            programId={id}
            defaultPrompt={program.requirements?.trim() || program.description?.trim() || ''}
            existing={new Set(recruits.map((r) => r.creator_id))}
            onAdded={load}
          />
          <InviteCreators programId={id} existing={new Set(recruits.map((r) => r.creator_id))} onAdded={load} />
          <SavedCreatorsSegment programId={id} onAdded={load} />

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
              No recruits yet. Add influencers from{' '}
              <Link href="/lander" className="text-ink-900 underline">the home search</Link>.
            </div>
          )}
        </>
      ) : null}
    </>
  );
}

interface DiscoverResult {
  username: string;
  full_name: string;
  followers: number;
  engagement: number;
  score: number;
  creator_id?: string;
  is_verified: boolean;
  from?: 'db' | 'live';
}

// Brief-driven discovery: type (or reuse the campaign's requirements), crawl
// Instagram + the creator DB for relevant creators, and add them straight into
// this campaign — singly or all at once.
function FindCreators({ programId, defaultPrompt, existing, onAdded }: { programId: string; defaultPrompt: string; existing: Set<string>; onAdded: () => void }) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [results, setResults] = useState<DiscoverResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addingAll, setAddingAll] = useState(false);
  const [minFollowers, setMinFollowers] = useState(0);
  const [maxFollowers, setMaxFollowers] = useState(0);
  const [minER, setMinER] = useState(0);
  const [autoApplied, setAutoApplied] = useState<string[]>([]);

  async function run() {
    const p = prompt.trim();
    if (p.length < 2 || loading) return;
    // Lift any follower / ER thresholds written in the text into the filters,
    // so "1M+ followers, ER > 2%" is honoured instead of treated as keywords.
    const f = parseFilters(p);
    const applied: string[] = [];
    if (f.min != null) { setMinFollowers(f.min); applied.push(followersPlus(f.min)); }
    if (f.max != null) { setMaxFollowers(f.max); applied.push(followersUnder(f.max)); }
    if (f.er != null) { setMinER(f.er); applied.push(`ER ${trimNum(f.er)}%+`); }
    setAutoApplied(applied);
    setLoading(true);
    setResults([]);
    try {
      const d = await fetch('/api/discover-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, mode: 'live', max: 20 }),
      }).then((r) => r.json());
      setResults(Array.isArray(d.results) ? d.results : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function add(r: DiscoverResult) {
    const cid = r.creator_id;
    if (!cid || busy.has(cid)) return;
    setBusy((s) => new Set(s).add(cid));
    try {
      await fetch(`/api/programs/${programId}/recruits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: cid, relevance_score: r.score, source_prompt: prompt.trim() }),
      });
      setAdded((s) => new Set(s).add(cid));
      onAdded();
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(cid); return n; });
    }
  }

  const shown = results.filter(
    (r) =>
      r.followers >= minFollowers &&
      (maxFollowers === 0 || r.followers <= maxFollowers) &&
      (r.engagement ?? 0) >= minER,
  );

  async function addAll() {
    setAddingAll(true);
    try {
      for (const r of shown) {
        if (r.creator_id && !existing.has(r.creator_id) && !added.has(r.creator_id)) await add(r);
      }
    } finally {
      setAddingAll(false);
    }
  }

  const addableCount = shown.filter((r) => r.creator_id && !existing.has(r.creator_id) && !added.has(r.creator_id)).length;

  return (
    <div className="mt-6 p-4 rounded-2xl bg-white border border-border shadow-card transition-shadow hover:shadow-hover">
      <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Find &amp; add creators</div>
      <div className="flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="Describe who you need — e.g. fashion micro-creators in Delhi, 50K–300K, ER 2%+"
          className="flex-1 min-w-0 px-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-ink-900"
        />
        <button onClick={run} disabled={loading || prompt.trim().length < 2} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 hover:brightness-105" style={{ background: ACCENT }}>
          {loading ? 'Finding…' : 'Find creators'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="mt-3">
          {autoApplied.length > 0 && (
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-500">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f3f0ff] text-[#6C4DF6] font-medium px-2 py-0.5">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>
                Applied from your text: {autoApplied.join(' · ')}
              </span>
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <select value={minFollowers} onChange={(e) => setMinFollowers(Number(e.target.value))} className="px-2 py-1 rounded-lg border border-border bg-white focus:outline-none focus:border-ink-900">
              {withValue(MIN_FOLLOWER_OPTS, minFollowers).map((v) => (
                <option key={v} value={v}>{v === 0 ? 'Any followers' : followersPlus(v)}</option>
              ))}
            </select>
            <select value={maxFollowers} onChange={(e) => setMaxFollowers(Number(e.target.value))} className="px-2 py-1 rounded-lg border border-border bg-white focus:outline-none focus:border-ink-900" title="Cap follower count — useful for micro / nano creators">
              {withValue(MAX_FOLLOWER_OPTS, maxFollowers).map((v) => (
                <option key={v} value={v}>{v === 0 ? 'No max' : followersUnder(v)}</option>
              ))}
            </select>
            <select value={minER} onChange={(e) => setMinER(Number(e.target.value))} className="px-2 py-1 rounded-lg border border-border bg-white focus:outline-none focus:border-ink-900" title="Minimum engagement rate">
              {withValue(MIN_ER_OPTS, minER).map((v) => (
                <option key={v} value={v}>{v === 0 ? 'Any ER' : `${trimNum(v)}%+ ER`}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-ink-500">{shown.length} of {results.length} matches · {addableCount} new</span>
            <button onClick={addAll} disabled={addingAll || addableCount === 0} className="text-[12px] font-semibold disabled:opacity-50" style={{ color: ACCENT }}>
              {addingAll ? 'Adding…' : `+ Add all (${addableCount})`}
            </button>
          </div>
          <div className="max-h-[320px] overflow-auto rounded-xl border border-border-soft divide-y divide-border-soft">
            {shown.map((r) => {
              const isAdded = (r.creator_id && (existing.has(r.creator_id) || added.has(r.creator_id))) || false;
              const canAdd = Boolean(r.creator_id) && !isAdded;
              return (
                <div key={r.username} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#faf9ff] transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink-900 truncate flex items-center gap-1">
                      {r.full_name || `@${r.username}`}{r.is_verified && <span style={{ color: ACCENT }}>✔</span>}
                    </div>
                    <div className="text-[11px] text-ink-400 truncate">
                      @{r.username} · {kfmt(r.followers)}{r.engagement > 0 ? ` · ${r.engagement}% ER` : ''} · match {r.score}
                    </div>
                  </div>
                  <button
                    onClick={() => add(r)}
                    disabled={!canAdd || (r.creator_id ? busy.has(r.creator_id) : false)}
                    title={!r.creator_id ? 'Open this creator from search first to add' : undefined}
                    className="px-3 py-1.5 text-[12px] font-semibold rounded-lg disabled:opacity-60"
                    style={{ color: isAdded ? '#6b7280' : '#fff', background: isAdded ? '#f3f4f6' : ACCENT }}
                  >
                    {isAdded ? 'Added' : r.creator_id && busy.has(r.creator_id) ? '…' : 'Add'}
                  </button>
                </div>
              );
            })}
            {shown.length === 0 && (
              <div className="px-3 py-4 text-[12px] text-ink-400 text-center">No matches fit these filters — loosen the follower range or ER.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SearchCreator { id: string; handle: string; display_name: string | null; follower_count: number | string | null; primary_category: string | null }
interface SavedCreator { username: string; full_name?: string; followers?: number; category?: string }
// Your saved shortlist (localStorage) — add them straight into this campaign.
// Resolves the handle to a creator_id, then recruits (idempotent).
function SavedCreatorsSegment({ programId, onAdded }: { programId: string; onAdded: () => void }) {
  const [saved, setSaved] = useState<SavedCreator[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/saved')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.creators) setSaved(d.creators); })
      .catch(() => {
        try { const raw = localStorage.getItem('ii_saved_creators'); if (raw) setSaved(JSON.parse(raw)); } catch { /* ignore */ }
      });
  }, []);

  async function add(username: string) {
    setBusy(username);
    try {
      const r = await fetch(`/api/creators?q=${encodeURIComponent(username)}&limit=8`);
      const d = await r.json();
      const match = (d.creators ?? []).find((c: { handle?: string; id?: string }) => c.handle?.toLowerCase() === username.toLowerCase());
      if (!match?.id) { alert(`@${username} isn't in the database yet — open them from a search first.`); return; }
      await fetch(`/api/programs/${programId}/recruits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creator_id: match.id }) });
      setAdded((s) => new Set(s).add(username));
      onAdded();
    } finally { setBusy(null); }
  }

  if (saved.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Your saved creators ({saved.length})</div>
      <div className="rounded-2xl bg-white border border-border shadow-card divide-y divide-border-soft max-h-[300px] overflow-auto transition-shadow hover:shadow-hover">
        {saved.map((s) => {
          const isAdded = added.has(s.username);
          return (
            <div key={s.username} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#faf9ff] transition-colors">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink-900 truncate">{s.full_name || `@${s.username}`}</div>
                <div className="text-[11px] text-ink-400 truncate">@{s.username}{s.followers ? ` · ${kfmt(s.followers)}` : ''}{s.category ? ` · ${s.category}` : ''}</div>
              </div>
              <button
                onClick={() => add(s.username)}
                disabled={isAdded || busy === s.username}
                className="px-3 py-1.5 text-[12px] font-semibold rounded-lg disabled:opacity-60"
                style={{ color: isAdded ? '#6b7280' : '#fff', background: isAdded ? '#f3f4f6' : ACCENT }}
              >
                {isAdded ? 'Added' : busy === s.username ? '…' : 'Add'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
              <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-soft last:border-0 hover:bg-[#faf9ff] transition-colors">
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
