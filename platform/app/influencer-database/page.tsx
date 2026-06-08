'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Creator { id: string; handle: string; display_name: string | null; follower_count: number | string | null; primary_category: string | null; engagement_rate: number | string | null; cred_score: string | null; is_verified: boolean | null }

const k = (v: number | string | null): string => { const x = Number(v) || 0; return x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(x); };
const er = (v: number | string | null): string => { const x = Number(v); return Number.isFinite(x) && x !== 0 ? (x * 100).toFixed(1) + '%' : '—'; };

export default function InfluencerDatabaseFeature() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/creators?limit=8&sort=followers')
      .then((r) => r.json())
      .then((d) => { setCreators(d.creators ?? []); setTotal(d.total ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
            <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Influencer Database</span>
            <h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-tight">The largest scored creator database</h1>
            <p className="mt-3 text-[15px] text-ink-600 max-w-xl mx-auto">{total != null ? <><span className="font-semibold text-ink-900">{total.toLocaleString('en-IN')}</span> Indian creators indexed</> : 'Thousands of Indian creators indexed'} — every profile credibility-scored, searchable by category, tier and engagement.</p>
            <Link href="/database" className="inline-block mt-6 px-6 py-3 rounded-xl text-white text-[15px] font-semibold bg-ink-900 hover:bg-ink-800">Browse the database</Link>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-bold text-ink-900">Top creators right now</h2>
            <Link href="/database" className="text-[13px] font-semibold" style={{ color: ACCENT }}>See all →</Link>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="w-9 h-9 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
          ) : (
            <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
              <div className="hidden sm:grid grid-cols-[2fr_1.2fr_0.9fr_0.9fr] px-4 py-2.5 bg-[#f7f7fb] text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
                <span>Creator</span><span>Category</span><span className="text-right">Followers</span><span className="text-right">ER · Quality</span>
              </div>
              {creators.map((c) => (
                <Link key={c.id} href={`/insights/${encodeURIComponent(c.handle)}`} className="grid grid-cols-2 sm:grid-cols-[2fr_1.2fr_0.9fr_0.9fr] gap-y-1 px-4 py-3 items-center border-t border-border-soft text-[13px] hover:bg-[#faf9ff]">
                  <span className="font-medium text-ink-900 truncate flex items-center gap-1.5 col-span-2 sm:col-span-1">{c.display_name || `@${c.handle}`}{c.is_verified && <span style={{ color: ACCENT }}>✔</span>}</span>
                  <span className="text-ink-600 truncate capitalize">{c.primary_category || '—'}</span>
                  <span className="text-ink-800 tabular-nums sm:text-right font-medium">{k(c.follower_count)}</span>
                  <span className="flex items-center gap-2 sm:justify-end">
                    <span className="text-ink-500 tabular-nums text-[12px]">{er(c.engagement_rate)}</span>
                    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md text-white" style={{ background: Number(c.cred_score) >= 80 ? '#10b981' : Number(c.cred_score) >= 60 ? '#f59e0b' : '#9aa0ad' }}>{c.cred_score ?? '—'}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
