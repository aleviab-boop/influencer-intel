'use client';

import { useEffect, useState } from 'react';
import { MarketingNav, ACCENT } from '@/components/marketing';

type AssetStatus = 'draft' | 'in_review' | 'approved' | 'changes';
type AssetType = 'reel' | 'image' | 'carousel' | 'story';

interface Asset {
  id: string;
  program_id: string | null;
  program_name: string | null;
  creator_handle: string | null;
  title: string;
  asset_type: AssetType;
  asset_url: string | null;
  status: AssetStatus;
  version: number;
  note: string | null;
}
interface Program { id: string; name: string }

const STATUS: Record<AssetStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'text-ink-600 bg-[#f2f2f7]' },
  in_review: { label: 'In review', cls: 'text-orange-700 bg-orange-50' },
  approved: { label: 'Approved', cls: 'text-emerald-700 bg-emerald-50' },
  changes: { label: 'Changes', cls: 'text-amber-700 bg-amber-50' },
};
const TYPES: AssetType[] = ['reel', 'image', 'carousel', 'story'];
const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'changes'];

export default function MediaPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<AssetStatus | 'all'>('all');

  async function load() {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([fetch('/api/media').then((r) => r.json()), fetch('/api/programs').then((r) => r.json())]);
      setAssets(a.assets ?? []);
      setPrograms(p.programs ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function patch(id: string, patch: Partial<Asset>) {
    setAssets((as) => as.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    await fetch(`/api/media/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => load());
    if (patch.status === 'in_review') void load(); // version may bump server-side
  }
  async function remove(id: string) {
    if (!confirm('Delete this asset?')) return;
    setAssets((as) => as.filter((a) => a.id !== id));
    await fetch(`/api/media/${id}`, { method: 'DELETE' });
  }

  const counts = { total: assets.length, in_review: assets.filter((a) => a.status === 'in_review').length, approved: assets.filter((a) => a.status === 'approved').length };
  const visible = filter === 'all' ? assets : assets.filter((a) => a.status === filter);

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Media Management</div>
            <h1 className="text-2xl font-bold text-ink-900">Creative library</h1>
          </div>
          <button onClick={() => setCreating((c) => !c)} className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800">+ Add creative</button>
        </div>

        {!loading && assets.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Summary label="Assets" value={String(counts.total)} />
            <Summary label="In review" value={String(counts.in_review)} accent />
            <Summary label="Approved" value={String(counts.approved)} tone="green" />
          </div>
        )}

        {creating && <CreateForm programs={programs} onCreated={() => { setCreating(false); void load(); }} onCancel={() => setCreating(false)} />}

        {!loading && assets.length > 0 && (
          <div className="flex gap-1 p-1 rounded-lg bg-white border border-border w-max mb-4">
            {(['all', ...STATUSES] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-[13px] ${filter === f ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'}`}>{f === 'all' ? 'All' : STATUS[f].label}</button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#FBE3DA] border-t-[#F2542D] animate-spin" /></div>
        ) : assets.length === 0 ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">No creatives yet. Add one to start the approval workflow.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((a) => (
              <AssetCard key={a.id} a={a} onPatch={patch} onRemove={remove} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AssetCard({ a, onPatch, onRemove }: { a: Asset; onPatch: (id: string, p: Partial<Asset>) => void; onRemove: (id: string) => void }) {
  let h = 0;
  for (let i = 0; i < a.title.length; i++) h = (h * 31 + a.title.charCodeAt(i)) >>> 0;
  return (
    <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden flex flex-col">
      <div className="relative h-36 grid place-items-center" style={{ background: a.asset_url ? '#000' : `linear-gradient(135deg, hsl(${h % 360} 60% 70%), hsl(${(h + 40) % 360} 60% 55%))` }}>
        {a.asset_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.asset_url} alt={a.title} className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        ) : (
          <span className="text-white/90 text-[12px] uppercase tracking-wider font-semibold">{a.asset_type}</span>
        )}
        <span className={`absolute top-2 right-2 text-[11px] px-2 py-0.5 rounded-full ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span>
        {a.version > 1 && <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/90 text-ink-600">v{a.version}</span>}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <div className="font-semibold text-[14px] text-ink-900 truncate">{a.title}</div>
        <div className="text-[12px] text-ink-400 truncate">{[a.program_name, a.creator_handle && `@${a.creator_handle}`].filter(Boolean).join(' · ') || a.asset_type}</div>
        <select value={a.status} onChange={(e) => onPatch(a.id, { status: e.target.value as AssetStatus })} className="mt-2.5 w-full px-2 py-1.5 border border-border bg-white text-[12px] text-ink-900 rounded-md focus:outline-none focus:border-ink-900">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
        <div className="mt-2 flex items-center gap-2">
          {a.asset_url && <a href={a.asset_url} target="_blank" rel="noopener noreferrer" className="text-[12px] hover:underline" style={{ color: ACCENT }}>Open ↗</a>}
          <button onClick={() => onRemove(a.id)} className="ml-auto text-[12px] text-ink-400 hover:text-rose-600">Delete</button>
        </div>
      </div>
    </div>
  );
}

function CreateForm({ programs, onCreated, onCancel }: { programs: Program[]; onCreated: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssetType>('reel');
  const [url, setUrl] = useState('');
  const [programId, setProgramId] = useState('');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (title.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), asset_type: type, asset_url: url.trim() || undefined, program_id: programId || undefined, creator_handle: handle.trim() || undefined }) });
      if (r.ok) onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 p-5 rounded-2xl bg-white border border-border shadow-card">
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Diwali Reel v1" className={inp} /></Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as AssetType)} className={inp}>{TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}</select>
        </Field>
        <Field label="Asset URL / thumbnail (optional)"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inp} /></Field>
        <Field label="Campaign (optional)">
          <select value={programId} onChange={(e) => setProgramId(e.target.value)} className={inp}><option value="">—</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
        <Field label="Creator handle (optional)"><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@creator" className={inp} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-ink-600 hover:text-ink-900">Cancel</button>
        <button onClick={submit} disabled={busy} className="px-5 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50">{busy ? 'Adding…' : 'Add creative'}</button>
      </div>
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[12px] text-ink-500 mb-1 block">{label}</span>{children}</label>;
}
function Summary({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: 'green' }) {
  const color = tone === 'green' ? 'text-emerald-700' : accent ? 'text-[#F2542D]' : 'text-ink-900';
  return <div className="rounded-2xl bg-white border border-border p-4 shadow-card"><div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div><div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div></div>;
}
