'use client';

import { useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

const BANDS: Record<string, { t: string; c: string }> = {
  high: { t: 'Highly authentic', c: '#10b981' },
  mixed: { t: 'Mixed signals', c: '#f59e0b' },
  low: { t: 'Low authenticity', c: '#f43f5e' },
};

interface PostView { url: string | null; type: string | null; posted_at: string | null; likes: number; comments: number; views: number; er_pct: number }
interface Metrics { posts: number; avg_likes: number; avg_comments: number; avg_views: number; median_er_pct: number; median_cpl_pct: number; consistency: 'steady' | 'variable' | 'erratic'; top_er_pct: number; low_er_pct: number }
interface Result {
  authenticity: number;
  band: { t: string; c: string };
  basis: 'verified' | 'per_post' | 'aggregate' | 'credibility' | 'insufficient';
  postsAnalyzed: number;
  signals: { label: string; ok: boolean; detail: string }[];
  metrics: Metrics | null;
  posts: PostView[];
}

const kfmt = (v: number): string => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v));
const fmtDate = (s: string | null): string => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export default function FakeFollowerChecker() {
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function check() {
    if (!handle.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setMeta(null);
    try {
      const r = await fetch(`/api/tools/authenticity?handle=${encodeURIComponent(handle.trim().replace(/^@/, ''))}`);
      const d = await r.json();
      if (!r.ok || d.error) {
        setError(d.error === 'not_found' ? 'Creator not found in our database. Try another handle.' : (d.error || 'Something went wrong.'));
        return;
      }
      setMeta(`@${d.handle}${d.display_name ? ` · ${d.display_name}` : ''} · ${Number(d.followers).toLocaleString('en-IN')} followers`);
      setResult({
        authenticity: d.score,
        band: BANDS[d.band] ?? { t: 'Mixed signals', c: '#f59e0b' },
        basis: d.basis,
        postsAnalyzed: d.posts_analyzed,
        signals: d.signals ?? [],
        metrics: d.metrics ?? null,
        posts: d.posts ?? [],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="grid-bg absolute inset-0 opacity-60" />
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full blur-3xl opacity-30" style={{ background: ACCENT }} />
          <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-12 text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold mb-5" style={{ background: ACCENT_SOFT, color: ACCENT }}>
              <Shield /> Free tool
            </span>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-ink-900">Authenticity Score</h1>
            <p className="mt-4 text-[16px] text-ink-600 max-w-xl mx-auto">Estimate how authentic a creator’s audience really is — a 0–100 score from engagement, comment quality and follower ratios across our database of Indian creators.</p>

            <div className="mt-8 max-w-xl mx-auto rounded-2xl bg-white border-2 border-[#e3def9] focus-within:border-[#6C4DF6] shadow-[0_12px_50px_rgba(108,77,246,0.12)] transition-colors p-2 flex gap-2">
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && check()}
                placeholder="Enter a creator handle, e.g. @creator"
                className="flex-1 px-4 py-3 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
              />
              <button onClick={check} disabled={loading} className="px-6 py-3 text-sm font-semibold text-white bg-ink-900 rounded-xl hover:bg-ink-800 disabled:opacity-50 whitespace-nowrap">{loading ? 'Checking…' : 'Check audience'}</button>
            </div>
            {error && <div className="mt-3 text-sm text-rose-700">{error}</div>}
            <p className="mt-3 text-[12px] text-ink-400">No login required · results from real engagement signals</p>
          </div>
        </section>

        {/* Result */}
        {result && (
          <section className="max-w-3xl mx-auto px-6 -mt-6 relative z-10">
            <div className="ii-fadeup rounded-2xl bg-white border border-border shadow-[0_12px_40px_rgba(0,0,0,0.08)] p-7">
              {meta && <div className="text-[13px] text-ink-500 mb-1 text-center">{meta}</div>}
              {result.basis === 'insufficient' ? (
                <div className="py-8 text-center">
                  <div className="text-[15px] font-semibold text-ink-900">Not enough public data to score yet</div>
                  <p className="mt-2 text-[13px] text-ink-500 max-w-md mx-auto">We don’t have recent engagement or a credibility signal on file for this creator. Connecting their Instagram gives a verified, reach-based score.</p>
                </div>
              ) : (
                <>
                  <div className="text-[11px] mb-5 text-center">
                    {result.basis === 'verified' ? <span className="text-emerald-600 font-medium">✓ Verified — reach-based, from {result.postsAnalyzed} connected posts</span>
                      : result.basis === 'per_post' ? <span className="text-ink-400">Analyzed {result.postsAnalyzed} recent posts</span>
                      : result.basis === 'credibility' ? <span className="text-ink-400">Based on credibility signals — limited recent engagement on file</span>
                      : <span className="text-ink-400">Based on profile averages</span>}
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-7">
                    <Gauge value={result.authenticity} color={result.band.c} />
                    <div className="flex-1 w-full">
                      <div className="inline-block px-3 py-1 rounded-full text-[13px] font-semibold text-white mb-3" style={{ background: result.band.c }}>{result.band.t}</div>
                      <div className="space-y-2.5">
                        {result.signals.map((s) => (
                          <div key={s.label} className="flex items-center gap-2.5 text-[13px]">
                            <span className={`w-5 h-5 shrink-0 rounded-full grid place-items-center text-white text-[11px] ${s.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}>{s.ok ? '✓' : '!'}</span>
                            <span className="text-ink-700">{s.label}</span>
                            <span className="ml-auto text-ink-400 tabular-nums">{s.detail}</span>
                          </div>
                        ))}
                      </div>
                      {(result.basis === 'per_post' || result.basis === 'aggregate' || result.basis === 'verified') && (
                        <div className="mt-4 text-[12px] text-ink-400">An estimated {100 - result.authenticity}% of engagement signals look low-quality or inactive.</div>
                      )}
                    </div>
                  </div>
                </>
              )}
              <p className="mt-6 pt-5 border-t border-border-soft text-[12px] text-ink-400">Heuristic estimate from public signals — not a definitive audit.</p>
            </div>

            {/* Post-level metrics */}
            {result.metrics && result.posts.length > 0 && (
              <div className="ii-fadeup mt-5 rounded-2xl bg-white border border-border shadow-[0_12px_40px_rgba(0,0,0,0.06)] p-7">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <h3 className="text-[15px] font-bold text-ink-900">Recent post analysis</h3>
                  <span className="text-[12px] text-ink-400">{result.metrics.posts} posts · engagement looks {result.metrics.consistency}</span>
                </div>

                {/* aggregate metric tiles */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                  <MetricTile label="Avg likes" value={kfmt(result.metrics.avg_likes)} />
                  <MetricTile label="Avg comments" value={kfmt(result.metrics.avg_comments)} />
                  <MetricTile label="Avg views" value={result.metrics.avg_views > 0 ? kfmt(result.metrics.avg_views) : '—'} />
                  <MetricTile label="Median ER" value={`${result.metrics.median_er_pct}%`} accent />
                  <MetricTile label="Comments / like" value={`${result.metrics.median_cpl_pct}%`} />
                </div>

                {/* per-post table */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="hidden sm:grid grid-cols-[1fr_0.8fr_0.8fr_0.8fr_0.9fr] px-4 py-2.5 bg-[#f7f7fb] text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
                    <span>Post</span><span className="text-right">Likes</span><span className="text-right">Comments</span><span className="text-right">Views</span><span className="text-right">ER</span>
                  </div>
                  {result.posts.map((p, i) => {
                    const best = p.er_pct === result.metrics!.top_er_pct;
                    return (
                      <a key={i} href={p.url ?? undefined} target="_blank" rel="noopener noreferrer" className="grid grid-cols-2 sm:grid-cols-[1fr_0.8fr_0.8fr_0.8fr_0.9fr] gap-y-1 px-4 py-2.5 border-t border-border-soft items-center text-[13px] hover:bg-[#faf9ff] transition-colors">
                        <span className="text-ink-700 col-span-2 sm:col-span-1 flex items-center gap-2">
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#f2f2f7] text-ink-500 capitalize">{p.type ?? 'post'}</span>
                          <span className="text-ink-400">{fmtDate(p.posted_at)}</span>
                        </span>
                        <span className="text-ink-700 tabular-nums sm:text-right"><span className="sm:hidden text-ink-400">Likes </span>{kfmt(p.likes)}</span>
                        <span className="text-ink-700 tabular-nums sm:text-right"><span className="sm:hidden text-ink-400">Comments </span>{kfmt(p.comments)}</span>
                        <span className="text-ink-500 tabular-nums sm:text-right"><span className="sm:hidden text-ink-400">Views </span>{p.views > 0 ? kfmt(p.views) : '—'}</span>
                        <span className="tabular-nums sm:text-right font-medium flex items-center sm:justify-end gap-1.5" style={{ color: best ? '#10b981' : '#374151' }}>
                          <span className="sm:hidden text-ink-400">ER </span>{p.er_pct}%{best && <span className="text-[10px]">▲ top</span>}
                        </span>
                      </a>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11px] text-ink-400">ER per post = (likes + comments) ÷ followers. Consistency compares engagement across posts — wildly uneven or eerily flat engagement is a red flag.</p>
              </div>
            )}
          </section>
        )}

        {/* What we analyze */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-center text-2xl md:text-3xl font-bold tracking-tight text-ink-900">What the check looks at</h2>
          <p className="text-center text-[15px] text-ink-600 mt-2 mb-10 max-w-2xl mx-auto">A blend of signals that bot-inflated accounts struggle to fake all at once.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ANALYZE.map((a) => (
              <div key={a.t} className="rounded-2xl bg-white border border-border shadow-card p-5">
                <div className="w-10 h-10 rounded-xl grid place-items-center mb-3" style={{ background: ACCENT_SOFT, color: ACCENT }}>{a.icon}</div>
                <div className="font-semibold text-ink-900 text-[15px]">{a.t}</div>
                <p className="mt-1 text-[13px] text-ink-500 leading-relaxed">{a.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-5xl mx-auto px-6 pb-20">
          <div className="rounded-3xl px-8 py-12 text-center text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Vet every creator before you pay them</h2>
            <p className="mt-2 text-[15px] text-white/85 max-w-xl mx-auto">Influencer Intel scores authenticity, engagement and brand-fit across thousands of creators — so you never recruit a fake.</p>
            <a href="/lander" className="inline-block mt-6 px-6 py-3 rounded-xl bg-white text-[14px] font-semibold" style={{ color: ACCENT }}>Explore the platform</a>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

function MetricTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-[#fafafc] px-3 py-3 text-center">
      <div className={`text-[18px] font-bold tabular-nums ${accent ? 'text-[#6C4DF6]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}

function Gauge({ value, color }: { value: number; color: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - clamp(value, 0, 100) / 100);
  return (
    <div className="relative w-[140px] h-[140px] shrink-0">
      <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef0f6" strokeWidth="12" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.22,.61,.36,1)' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-4xl font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-1">authentic</div>
        </div>
      </div>
    </div>
  );
}

function Shield() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>);
}

const I = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const ANALYZE = [
  { t: 'Engagement health', d: 'Likes + comments measured against the realistic benchmark for the creator’s follower tier.', icon: <svg {...I}><path d="M6 20V10M12 20V4M18 20v-6" /></svg> },
  { t: 'Comment authenticity', d: 'Real audiences leave comments. A healthy comments-per-like ratio is hard for bots to fake.', icon: <svg {...I}><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /></svg> },
  { t: 'Follow ratio', d: 'Mass-following and follow-back loops leave a tell-tale follower-to-following signature.', icon: <svg {...I}><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11l2 2 4-4" /></svg> },
  { t: 'Credibility score', d: 'Our composite quality score factors authenticity, consistency and audience signals into one number.', icon: <svg {...I}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg> },
];
