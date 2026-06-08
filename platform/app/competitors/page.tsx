'use client';

import { useState } from 'react';
import { MarketingNav, ACCENT } from '@/components/marketing';

interface Creator {
  id: string;
  handle: string;
  display_name: string | null;
  profile_url: string;
  follower_count: number | string | null;
  primary_category: string | null;
  quality_score: number | string | null;
  verified: boolean;
  confidence: 'paid' | 'mention';
  matched_brand: string | null;
}
interface Data {
  a: string;
  b: string | null;
  a_creators: Creator[];
  b_creators: Creator[];
  overlap: Creator[];
}

const k = (v: number | string | null): string => {
  const n = Number(v) || 0;
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};

export default function CompetitorsPage() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (a.trim().length < 2) {
      setError('Enter a brand to analyze (min 2 characters).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/competitors?a=${encodeURIComponent(a.trim())}&b=${encodeURIComponent(b.trim())}`);
      const d = await r.json();
      if (!r.ok) setError(d.error ?? 'Failed');
      else setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const aN = data?.a_creators.length ?? 0;
  const bN = data?.b_creators.length ?? 0;
  const total = aN + bN;
  const aPct = total ? Math.round((aN / total) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Competitor Analysis</div>
        <h1 className="text-2xl font-bold text-ink-900 mb-2">Who works with whom</h1>
        <p className="text-[15px] text-ink-600 mb-6">Enter your brand and a competitor — we surface creators with a detected partnership for each brand and the overlap between them. A <span className="font-medium text-emerald-700">Verified</span> tag means a paid-partnership label was spotted on their profile.</p>

        <div className="rounded-2xl bg-white border border-border shadow-card p-4 flex flex-col sm:flex-row gap-2 mb-6">
          <input value={a} onChange={(e) => setA(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="Your brand (e.g. Nykaa)" className={inp} />
          <input value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="Competitor (optional, e.g. Myntra)" className={inp} />
          <button onClick={run} disabled={loading} className="px-6 py-2.5 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 whitespace-nowrap">{loading ? 'Analyzing…' : 'Analyze'}</button>
        </div>

        {error && <div className="mb-6 text-sm text-rose-700">{error}</div>}

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : data ? (
          <>
            {/* share of voice */}
            {data.b && (
              <div className="rounded-2xl bg-white border border-border shadow-card p-5 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[13px] font-semibold text-ink-900">Share of voice</div>
                  <div className="text-[12px] text-ink-400">{data.overlap.length} creators work with both</div>
                </div>
                <div className="flex h-6 rounded-full overflow-hidden border border-border">
                  <div className="grid place-items-center text-[11px] text-white font-medium" style={{ width: `${aPct}%`, background: ACCENT }}>{aPct > 12 ? `${data.a} ${aPct}%` : ''}</div>
                  <div className="grid place-items-center text-[11px] text-ink-700 font-medium bg-[#e5e1f7]" style={{ width: `${100 - aPct}%` }}>{100 - aPct > 12 ? `${data.b} ${100 - aPct}%` : ''}</div>
                </div>
                <div className="mt-2 flex justify-between text-[12px] text-ink-500"><span>{data.a}: {aN}</span><span>{data.b}: {bN}</span></div>
              </div>
            )}

            <div className={`grid gap-4 ${data.b ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
              <BrandColumn title={data.a} creators={data.a_creators} overlapIds={new Set(data.overlap.map((c) => c.id))} />
              {data.b && <BrandColumn title={data.b} creators={data.b_creators} overlapIds={new Set(data.overlap.map((c) => c.id))} />}
            </div>

            {data.overlap.length > 0 && (
              <div className="mt-6 rounded-2xl bg-white border border-border shadow-card p-5">
                <div className="text-[13px] font-semibold text-ink-900 mb-3">Shared creators ({data.overlap.length})</div>
                <div className="flex flex-wrap gap-2">
                  {data.overlap.map((c) => (
                    <a key={c.id} href={c.profile_url} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1 rounded-full text-[12px] border border-[#dcd6f7] hover:bg-[#f6f4ff]" style={{ color: ACCENT }}>
                      {c.display_name ?? `@${c.handle}`}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-ink-400 py-16 text-center">Enter a brand above to see its creators.</div>
        )}
      </main>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: 'paid' | 'mention' }) {
  return confidence === 'paid'
    ? <span title="A paid-partnership tag was detected" className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 shrink-0">PAID PARTNER</span>
    : <span title="Brand detected on profile, no paid-partnership tag" className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#f1f0f7] text-ink-500 shrink-0">MENTIONED</span>;
}

function BrandColumn({ title, creators, overlapIds }: { title: string; creators: Creator[]; overlapIds: Set<string> }) {
  return (
    <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="font-semibold text-ink-900 truncate">{title}</span>
        <span className="text-[12px] text-ink-400">{creators.length} creators</span>
      </div>
      {creators.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-ink-400">No creators with a detected “{title}” partnership.</div>
      ) : (
        <div className="max-h-[460px] overflow-auto scroll-thin">
          {creators.map((c) => (
            <a key={c.id} href={c.profile_url} target="_blank" rel="noopener noreferrer" title={`Open @${c.handle} on Instagram`} className="flex items-center gap-3 px-4 py-2.5 border-b border-border-soft last:border-0 hover:bg-[#faf9ff] group">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink-900 truncate flex items-center gap-1.5">
                  {c.display_name ?? `@${c.handle}`}
                  <ConfidenceBadge confidence={c.confidence} />
                  {overlapIds.has(c.id) && <span className="text-[9px] px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ background: ACCENT }}>BOTH</span>}
                </div>
                <div className="text-[11px] text-ink-400 truncate">{c.matched_brand ? `via “${c.matched_brand}”` : (c.primary_category ?? 'creator')}</div>
              </div>
              <span className="text-[12px] text-ink-500 tabular-nums shrink-0">{k(c.follower_count)}</span>
              <span className="shrink-0 w-6 h-6 grid place-items-center rounded-md text-white opacity-80 group-hover:opacity-100" style={{ background: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const inp = 'flex-1 px-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
