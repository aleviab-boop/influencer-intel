'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT } from '@/components/marketing';

interface Creator {
  id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | string | null;
  primary_category: string | null;
  primary_city: string | null;
  primary_state: string | null;
  is_verified: boolean | null;
  engagement_rate: number | string | null;
  cred_score: string | null;
  vision_niche: string | null;
}

const CATEGORIES = ['Fashion', 'Beauty', 'Lifestyle', 'Fitness', 'Travel', 'Food', 'Music', 'Art', 'Gaming', 'Tech', 'Comedy', 'Education'];
const TIERS = [
  { v: '', t: 'All tiers' },
  { v: 'mega', t: 'Mega · 1M+' },
  { v: 'macro', t: 'Macro · 100K–1M' },
  { v: 'micro', t: 'Micro · 10K–100K' },
  { v: 'nano', t: 'Nano · 5K–10K' },
];
const SORTS = [
  { v: 'followers', t: 'Most followers' },
  { v: 'credibility', t: 'Highest quality' },
  { v: 'recent', t: 'Recently updated' },
];

const fmt = (v: number | string | null): string => {
  const n = Number(v) || 0;
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};
const erPct = (v: number | string | null): string => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return (n * 100).toFixed(1) + '%';
};
const scoreColor = (s: string | null): string => {
  const n = Number(s);
  if (!Number.isFinite(n)) return '#9aa0ad';
  return n >= 80 ? '#10b981' : n >= 60 ? '#f59e0b' : '#f43f5e';
};

export default function DatabasePage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [category, setCategory] = useState('');
  const [tier, setTier] = useState('');
  const [verified, setVerified] = useState(false);
  const [sort, setSort] = useState('followers');

  const [creators, setCreators] = useState<Creator[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '60', sort });
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
    if (category) params.set('category', category);
    if (tier) params.set('tier', tier);
    if (verified) params.set('verified', '1');
    setLoading(true);
    return fetch(`/api/creators?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => { setCreators(d.creators ?? []); setTotal(d.total ?? null); })
      .finally(() => setLoading(false));
  }, [debouncedQ, category, tier, verified, sort]);

  useEffect(() => { void load(); }, [load]);

  const hasFilters = useMemo(() => !!(debouncedQ || category || tier || verified), [debouncedQ, category, tier, verified]);

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-1">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Influencer Database</div>
            <h1 className="text-2xl font-bold text-ink-900">Browse creators</h1>
          </div>
          <div className="flex items-center gap-3">
            {total != null && <div className="text-[13px] text-ink-500">{total.toLocaleString('en-IN')} creators indexed</div>}
            <button onClick={() => setCreating((c) => !c)} className="px-4 py-2 text-sm font-semibold text-white bg-ink-900 rounded-xl hover:bg-ink-800">+ Add creator</button>
          </div>
        </div>
        <p className="text-[15px] text-ink-600 mb-6">Search and filter our scored database of Indian creators — every profile ranked by followers, engagement and a 0–100 quality score.</p>

        {creating && <AddCreatorForm onAdded={() => { setCreating(false); void load(); }} onCancel={() => setCreating(false)} />}

        {/* Controls */}
        <div className="rounded-2xl bg-white border border-border shadow-card p-3 flex flex-wrap items-center gap-2 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by handle or name…" className="w-full pl-9 pr-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900" />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} className={sel}>{TIERS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={sel}>{SORTS.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}</select>
          <button onClick={() => setVerified((v) => !v)} className={`px-3 py-2.5 rounded-lg text-[13px] font-medium border transition-colors ${verified ? 'text-white border-transparent' : 'text-ink-600 border-border hover:text-ink-900'}`} style={verified ? { background: ACCENT } : undefined}>Verified ✓</button>
          {hasFilters && <button onClick={() => { setQ(''); setCategory(''); setTier(''); setVerified(false); }} className="px-3 py-2.5 text-[13px] text-ink-400 hover:text-ink-700">Clear</button>}
        </div>

        {/* Results */}
        {loading && creators.length === 0 ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : creators.length === 0 ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">No creators match these filters. Try widening your search.</div>
        ) : (
          <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
            <div className="hidden sm:grid grid-cols-[2.4fr_1.2fr_1fr_0.8fr_0.9fr] px-4 py-3 border-b border-border text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
              <span>Creator</span><span>Category</span><span>Location</span><span className="text-right">Followers</span><span className="text-right">ER · Quality</span>
            </div>
            {creators.map((c) => (
              <Link
                key={c.id}
                href={`/insights/${encodeURIComponent(c.handle)}`}
                className="grid grid-cols-1 sm:grid-cols-[2.4fr_1.2fr_1fr_0.8fr_0.9fr] gap-y-1 items-center px-4 py-3 border-b border-border-soft last:border-0 hover:bg-[#faf9ff] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar c={c} />
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-ink-900 truncate flex items-center gap-1.5">
                      {c.display_name || `@${c.handle}`}
                      {c.is_verified && <span title="Verified" style={{ color: ACCENT }}>✔</span>}
                    </div>
                    <div className="text-[12px] text-ink-400 truncate">@{c.handle}</div>
                  </div>
                </div>
                <div className="text-[13px] text-ink-600 truncate capitalize">{c.primary_category || c.vision_niche || '—'}</div>
                <div className="text-[13px] text-ink-500 truncate">{[c.primary_city, c.primary_state].filter(Boolean).join(', ') || '—'}</div>
                <div className="text-[13px] text-ink-800 tabular-nums sm:text-right font-medium">{fmt(c.follower_count)}</div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="text-[12px] text-ink-500 tabular-nums">{erPct(c.engagement_rate)}</span>
                  <span className="text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md text-white" style={{ background: scoreColor(c.cred_score) }}>{c.cred_score ?? '—'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {!loading && creators.length > 0 && <div className="mt-3 text-[12px] text-ink-400 text-center">Showing {creators.length} creators{total ? ` of ${total.toLocaleString('en-IN')}` : ''}.</div>}
      </main>
    </div>
  );
}

function AddCreatorForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ handle: '', display_name: '', primary_category: '', primary_city: '', follower_count: '', following_count: '', avg_likes: '', avg_comments: '', bio: '', profile_photo_url: '' });
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function fetchFromIg() {
    const h = f.handle.trim().replace(/^@/, '');
    if (h.length < 2) return setErr('Enter a handle to fetch.');
    setFetching(true); setErr(null); setNote(null);
    try {
      const r = await fetch(`/api/scrape/instagram?handle=${encodeURIComponent(h)}`);
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? 'Fetch failed.'); return; }
      const p = d.profile;
      setF((prev) => ({
        ...prev,
        handle: p.handle,
        display_name: p.display_name ?? prev.display_name,
        primary_category: p.category ?? prev.primary_category,
        follower_count: String(p.follower_count ?? ''),
        following_count: String(p.following_count ?? ''),
        avg_likes: p.avg_likes != null ? String(p.avg_likes) : '',
        avg_comments: p.avg_comments != null ? String(p.avg_comments) : '',
        bio: p.biography ?? prev.bio,
        profile_photo_url: p.profile_photo_url ?? prev.profile_photo_url,
      }));
      setNote(`Pulled @${p.handle} from Instagram — ${Number(p.follower_count).toLocaleString('en-IN')} followers, ${p.recent_posts.length} recent posts.`);
    } catch {
      setErr('Couldn’t reach Instagram. Try again.');
    } finally { setFetching(false); }
  }

  async function submit() {
    setErr(null);
    if (f.handle.trim().replace(/^@/, '').length < 2) return setErr('Handle is required.');
    setBusy(true);
    try {
      const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
      const r = await fetch('/api/creators', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: f.handle, display_name: f.display_name || undefined, primary_category: f.primary_category || undefined,
          primary_city: f.primary_city || undefined, follower_count: num(f.follower_count), following_count: num(f.following_count),
          avg_likes: num(f.avg_likes), avg_comments: num(f.avg_comments), bio: f.bio || undefined, profile_photo_url: f.profile_photo_url || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? 'Failed to add creator.'); return; }
      onAdded();
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-6 p-5 rounded-2xl bg-white border border-border shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold text-ink-900">Add a creator</div>
        <span className="text-[11px] text-ink-400">Paste a handle and fetch real data live from Instagram — free</span>
      </div>
      <div className="flex gap-2 mb-3">
        <input value={f.handle} onChange={set('handle')} onKeyDown={(e) => e.key === 'Enter' && fetchFromIg()} placeholder="@handle" className={dinp} autoFocus />
        <button onClick={fetchFromIg} disabled={fetching} className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 whitespace-nowrap" style={{ background: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)' }}>{fetching ? 'Fetching…' : 'Fetch from Instagram'}</button>
      </div>
      {note && <div className="mb-3 text-[12px] text-emerald-700">{note}</div>}
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Display name"><input value={f.display_name} onChange={set('display_name')} placeholder="Full name" className={dinp} /></Field>
        <Field label="Category"><input value={f.primary_category} onChange={set('primary_category')} placeholder="fashion" className={dinp} /></Field>
        <Field label="City"><input value={f.primary_city} onChange={set('primary_city')} placeholder="Mumbai" className={dinp} /></Field>
        <Field label="Followers"><input type="number" value={f.follower_count} onChange={set('follower_count')} placeholder="0" className={dinp} /></Field>
        <Field label="Following"><input type="number" value={f.following_count} onChange={set('following_count')} placeholder="0" className={dinp} /></Field>
        <Field label="Avg likes / post"><input type="number" value={f.avg_likes} onChange={set('avg_likes')} placeholder="0" className={dinp} /></Field>
        <Field label="Avg comments / post"><input type="number" value={f.avg_comments} onChange={set('avg_comments')} placeholder="0" className={dinp} /></Field>
        <Field label="Profile photo URL"><input value={f.profile_photo_url} onChange={set('profile_photo_url')} placeholder="https://…" className={dinp} /></Field>
      </div>
      <Field label="Bio (optional)" className="mt-3"><textarea value={f.bio} onChange={set('bio')} rows={2} placeholder="Short bio…" className={`${dinp} resize-none`} /></Field>
      <p className="mt-2 text-[11px] text-ink-400">Engagement rate is computed automatically from followers + avg likes/comments.</p>
      {err && <div className="mt-2 text-sm text-rose-700">{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-ink-600 hover:text-ink-900">Cancel</button>
        <button onClick={submit} disabled={busy} className="px-5 py-2 text-sm font-semibold text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50">{busy ? 'Adding…' : 'Add to database'}</button>
      </div>
    </div>
  );
}

const dinp = 'w-full px-3 py-2 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className ?? ''}`}><span className="text-[12px] text-ink-500 mb-1 block">{label}</span>{children}</label>;
}

function Avatar({ c }: { c: Creator }) {
  const [err, setErr] = useState(false);
  let h = 0;
  for (let i = 0; i < c.handle.length; i++) h = (h * 31 + c.handle.charCodeAt(i)) >>> 0;
  if (c.profile_photo_url && !err) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.profile_photo_url} alt={c.handle} onError={() => setErr(true)} className="w-9 h-9 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="w-9 h-9 rounded-full shrink-0 grid place-items-center text-white text-[13px] font-semibold" style={{ background: `linear-gradient(135deg, hsl(${h % 360} 55% 62%), hsl(${(h + 50) % 360} 55% 50%))` }}>
      {(c.display_name || c.handle).charAt(0).toUpperCase()}
    </div>
  );
}

const sel = 'px-3 py-2.5 border border-border bg-white text-[13px] text-ink-800 rounded-lg focus:outline-none focus:border-ink-900 cursor-pointer';
