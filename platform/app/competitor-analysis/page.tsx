'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, Reveal, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface BrandCreator { id: string; handle: string; display_name: string | null; profile_url: string; follower_count: number | string | null; primary_category: string | null; verified: boolean; confidence: 'paid' | 'mention'; matched_brand: string | null }
const k = (v: number | string | null): string => { const x = Number(v) || 0; return x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(x); };

export default function CompetitorAnalysisFeature() {
  const [brand, setBrand] = useState('Nykaa');
  const [input, setInput] = useState('Nykaa');
  const [creators, setCreators] = useState<BrandCreator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!brand.trim()) return;
    setLoading(true);
    fetch(`/api/competitors?a=${encodeURIComponent(brand.trim())}`)
      .then((r) => r.json())
      .then((d) => setCreators(d.a_creators ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brand]);

  const verified = creators.filter((c) => c.verified).length;

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
            <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Competitor Analysis</span>
            <Reveal><h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-tight">See who your competitors work with</h1></Reveal>
            <p className="mt-3 text-[15px] text-ink-600 max-w-xl mx-auto">Type a brand to surface creators with a detected partnership — verified from real profile data.</p>
            <div className="mt-6 max-w-md mx-auto flex gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && input.trim().length >= 2 && setBrand(input.trim())} placeholder="Brand name, e.g. Nykaa" className="flex-1 px-4 py-3 rounded-xl border border-border bg-white text-[15px] text-ink-900 focus:outline-none focus:border-ink-900" />
              <button onClick={() => input.trim().length >= 2 && setBrand(input.trim())} className="px-5 py-3 rounded-xl text-white text-[14px] font-semibold bg-ink-900 hover:bg-ink-800">Analyze</button>
            </div>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-10">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="w-9 h-9 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-6 max-w-md">
                <Stat label={`Creators with ${brand}`} value={String(creators.length)} accent />
                <Stat label="Verified partnerships" value={String(verified)} tone="green" />
              </div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[15px] font-bold text-ink-900">Creators working with {brand}</h2>
                <Link href="/competitors" className="text-[13px] font-semibold" style={{ color: ACCENT }}>Full analysis →</Link>
              </div>
              {creators.length === 0 ? (
                <div className="text-sm text-ink-400 py-12 text-center rounded-2xl border border-dashed border-border">No creators with a detected “{brand}” partnership. Try another brand.</div>
              ) : (
                <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
                  {creators.slice(0, 10).map((c) => (
                    <a key={c.id} href={c.profile_url} target="_blank" rel="noopener noreferrer" title={`Open @${c.handle} on Instagram`} className="flex items-center gap-3 px-4 py-2.5 border-b border-border-soft last:border-0 text-[13px] hover:bg-[#faf9ff] group">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink-900 truncate flex items-center gap-1.5">
                          {c.display_name || `@${c.handle}`}
                          {c.confidence === 'paid'
                            ? <span title="A paid-partnership tag was detected" className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">PAID PARTNER</span>
                            : <span title="Brand detected on profile, no paid-partnership tag" className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f1f0f7] text-ink-500">MENTIONED</span>}
                        </div>
                        <div className="text-[11px] text-ink-400 truncate">@{c.handle}{c.matched_brand ? ` · via “${c.matched_brand}”` : c.primary_category ? ` · ${c.primary_category}` : ''}</div>
                      </div>
                      <span className="text-ink-600 tabular-nums shrink-0">{k(c.follower_count)}</span>
                      <span className="shrink-0 w-6 h-6 grid place-items-center rounded-md text-white opacity-80 group-hover:opacity-100" style={{ background: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
                      </span>
                    </a>
                  ))}
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
