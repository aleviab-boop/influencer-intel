'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Asset { id: string; title: string; asset_type: string; asset_url: string | null; status: string; program_name: string | null; creator_handle: string | null }
const STATUS: Record<string, { t: string; c: string; b: string }> = {
  draft: { t: 'Draft', c: '#6b7280', b: '#f3f4f6' }, in_review: { t: 'In review', c: '#7c3aed', b: '#f5f3ff' },
  approved: { t: 'Approved', c: '#047857', b: '#ecfdf5' }, changes: { t: 'Changes', c: '#b45309', b: '#fffbeb' },
};

export default function MediaManagementFeature() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/media').then((r) => r.json()).then((d) => setAssets(d.assets ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const inReview = assets.filter((a) => a.status === 'in_review').length;
  const approved = assets.filter((a) => a.status === 'approved').length;

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
            <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Media Management</span>
            <h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-tight">Every campaign creative in one place</h1>
            <p className="mt-3 text-[15px] text-ink-600 max-w-xl mx-auto">Store, version and approve reels, images and carousels — with a clear status on every asset.</p>
            <Link href="/media" className="inline-block mt-6 px-6 py-3 rounded-xl text-white text-[15px] font-semibold bg-ink-900 hover:bg-ink-800">Open media library</Link>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-10">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="w-9 h-9 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-6">
                <Stat label="Assets" value={String(assets.length)} />
                <Stat label="In review" value={String(inReview)} accent />
                <Stat label="Approved" value={String(approved)} tone="green" />
              </div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[15px] font-bold text-ink-900">Recent creatives</h2>
                <Link href="/media" className="text-[13px] font-semibold" style={{ color: ACCENT }}>Open library →</Link>
              </div>
              {assets.length === 0 ? (
                <div className="text-sm text-ink-400 py-12 text-center rounded-2xl border border-dashed border-border">No creatives yet. <Link href="/media" className="text-ink-900 underline">Add one</Link> to start the approval workflow.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {assets.slice(0, 6).map((a) => {
                    let h = 0; for (let i = 0; i < a.title.length; i++) h = (h * 31 + a.title.charCodeAt(i)) >>> 0;
                    const st = STATUS[a.status] ?? STATUS.draft!;
                    return (
                      <Link key={a.id} href="/media" className="rounded-2xl bg-white border border-border shadow-card overflow-hidden hover:shadow-hover transition-shadow">
                        <div className="relative h-28 grid place-items-center" style={{ background: a.asset_url ? '#000' : `linear-gradient(135deg, hsl(${h % 360} 60% 70%), hsl(${(h + 40) % 360} 60% 55%))` }}>
                          {a.asset_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={a.asset_url} alt={a.title} className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                            : <span className="text-white/90 text-[11px] uppercase tracking-wider font-semibold">{a.asset_type}</span>}
                          <span className="absolute top-2 right-2 text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: st.c, background: st.b }}>{st.t}</span>
                        </div>
                        <div className="p-3">
                          <div className="font-semibold text-[14px] text-ink-900 truncate">{a.title}</div>
                          <div className="text-[12px] text-ink-400 truncate">{[a.program_name, a.creator_handle && `@${a.creator_handle}`].filter(Boolean).join(' · ') || a.asset_type}</div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: 'green' }) {
  const color = tone === 'green' ? 'text-emerald-700' : accent ? 'text-[#6C4DF6]' : 'text-ink-900';
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
