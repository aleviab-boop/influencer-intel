'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT } from '@/components/marketing';

interface SavedCreator {
  username: string;
  full_name?: string;
  followers?: number;
  profile_pic_url?: string | null;
  category?: string;
  email?: string | null;
  phone?: string | null;
  biography?: string;
  engagement?: number | null;
}

const KEY = 'ii_saved_creators';
const fmt = (n?: number): string => {
  if (n == null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
};

export default function SavedCreatorsPage() {
  const [saved, setSaved] = useState<SavedCreator[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [brief, setBrief] = useState('');

  useEffect(() => {
    const fromLocal = () => { try { const raw = localStorage.getItem(KEY); if (raw) setSaved(JSON.parse(raw)); } catch { /* ignore */ } };
    fetch('/api/saved')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.creators) setSaved(d.creators); else fromLocal(); })
      .catch(fromLocal)
      .finally(() => setLoaded(true));
  }, []);

  function remove(u: string) {
    setSaved((list) => {
      const next = list.filter((s) => s.username !== u);
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    void fetch(`/api/saved?handle=${encodeURIComponent(u)}`, { method: 'DELETE' }).catch(() => {});
  }
  function clearAll() {
    if (!confirm('Remove all saved creators?')) return;
    setSaved([]);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    void fetch('/api/saved?all=1', { method: 'DELETE' }).catch(() => {});
  }

  // Rank by brand-fit when a brief is typed: creators whose name/category/bio
  // mention the brief's keywords float up.
  const shown = useMemo(() => {
    const kws = brief.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (kws.length === 0) return saved;
    const score = (s: SavedCreator) => {
      const t = `${s.username} ${s.full_name ?? ''} ${s.category ?? ''} ${s.biography ?? ''}`.toLowerCase();
      return kws.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
    };
    return [...saved].sort((a, b) => score(b) - score(a));
  }, [saved, brief]);

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-9">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Your shortlist</div>
            <h1 className="text-2xl font-bold text-ink-900">Saved creators {saved.length > 0 && <span className="text-ink-400 font-semibold">· {saved.length}</span>}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/lander" className="px-4 py-2 text-sm font-medium rounded-xl border border-border text-ink-700 hover:bg-white">Find more creators</Link>
            {saved.length > 0 && (
              <button onClick={clearAll} className="px-4 py-2 text-sm font-medium rounded-xl border border-border text-ink-500 hover:text-rose-600 hover:border-rose-200">Clear all</button>
            )}
          </div>
        </div>

        {saved.length > 0 && (
          <div className="mb-4 rounded-2xl bg-white border border-border shadow-card p-4">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Rank by brand fit</label>
            <input
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Brief — e.g. sustainable skincare for Gen-Z women in Mumbai"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm text-ink-900 focus:outline-none focus:border-ink-900"
            />
            {brief.trim() && <p className="mt-1 text-[12px] text-ink-400">Sorted by how well each creator matches this brief.</p>}
          </div>
        )}

        {!loaded ? null : saved.length === 0 ? (
          <div className="text-center rounded-2xl border border-dashed border-border bg-white py-20">
            <div className="text-[15px] font-semibold text-ink-900">No saved creators yet</div>
            <p className="mt-1 text-sm text-ink-500">Bookmark creators from a search and they’ll show up here.</p>
            <Link href="/lander" className="mt-5 inline-block px-5 py-2.5 rounded-xl text-white text-sm font-medium" style={{ background: ACCENT }}>Start a search</Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {shown.map((s) => (
              <div key={s.username} className="flex items-center gap-3 rounded-2xl bg-white border border-border shadow-card px-4 py-3.5">
                <Avatar name={s.full_name || s.username} url={s.profile_pic_url} />
                <div className="min-w-0 flex-1">
                  <a href={`https://instagram.com/${s.username}`} target="_blank" rel="noreferrer" className="text-[14px] font-semibold text-ink-900 truncate hover:underline block">@{s.username}</a>
                  <div className="text-[12px] text-ink-500 truncate">
                    {fmt(s.followers)} followers{s.category ? ` · ${s.category}` : ''}{s.engagement ? ` · ${s.engagement}% ER` : ''}
                  </div>
                  {(s.email || s.phone) && (
                    <div className="text-[11px] text-ink-400 truncate mt-0.5">{[s.email, s.phone].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
                <a href={`https://instagram.com/${s.username}`} target="_blank" rel="noreferrer" title="Open on Instagram" className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-white" style={{ background: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
                </a>
                <button onClick={() => remove(s.username)} title="Remove from saved" className="shrink-0 w-7 h-7 grid place-items-center rounded-full text-ink-300 hover:text-rose-600 hover:bg-rose-50">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Avatar({ name, url }: { name: string; url?: string | null }) {
  const [err, setErr] = useState(false);
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  if (url && !err) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/ig-image?u=${encodeURIComponent(url)}`} alt={name} onError={() => setErr(true)} className="w-10 h-10 rounded-full object-cover shrink-0 bg-[#eee]" />;
  }
  return (
    <div className="w-10 h-10 rounded-full grid place-items-center text-white text-[12px] font-semibold shrink-0" style={{ background: `linear-gradient(135deg, hsl(${h % 360} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))` }}>{initials}</div>
  );
}
