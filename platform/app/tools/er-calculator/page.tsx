'use client';

import { useEffect, useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

const tierTarget = (f: number): number => (f >= 1e6 ? 1 : f >= 5e5 ? 1.3 : f >= 1e5 ? 1.8 : f >= 5e4 ? 2.5 : f >= 2e4 ? 3.5 : f >= 1e4 ? 4.5 : 6);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

interface ErData { handle: string; display_name: string | null; followers: number; avg_likes: number | null; avg_comments: number | null; er: number | null }

function parseHandle(v: string): string {
  const t = v.trim();
  const m = t.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const h = m ? m[1]! : t.replace(/^@/, '');
  return h.split(/[/?#]/)[0]!;
}
const kfmt = (v: number): string => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v));

export default function ERCalculator() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ErData | null>(null);
  const [verified, setVerified] = useState<{ er_pct: number; cpl_pct: number; posts: number; avg_reach: number } | null>(null);

  async function calculate() {
    const h = parseHandle(input);
    if (h.length < 2) return;
    setLoading(true);
    setError(null);
    setData(null);
    setVerified(null);
    try {
      const d = await fetch(`/api/creators?q=${encodeURIComponent(h)}&limit=1`).then((r) => r.json());
      const c = (d.creators ?? [])[0];
      if (!c) { setError(`We couldn’t find @${h} in our database. Try another handle.`); return; }
      const followers = Number(c.follower_count) || 0;
      const avg_likes = c.avg_likes != null ? Number(c.avg_likes) : null;
      const avg_comments = c.avg_comments != null ? Number(c.avg_comments) : null;
      let er: number | null = null;
      if (c.engagement_rate != null && Number(c.engagement_rate) > 0) er = Number(c.engagement_rate) * 100;
      else if (followers > 0 && (avg_likes || avg_comments)) er = (((avg_likes ?? 0) + (avg_comments ?? 0)) / followers) * 100;
      setData({ handle: c.handle, display_name: c.display_name, followers, avg_likes, avg_comments, er });
      fetch(`/api/tools/verified-engagement?handle=${encodeURIComponent(h)}`)
        .then((x) => x.json())
        .then((v) => { if (v?.verified) setVerified({ er_pct: v.er_pct, cpl_pct: v.cpl_pct, posts: v.posts, avg_reach: v.avg_reach }); })
        .catch(() => {});
    } catch {
      setError('Lookup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const followers = data?.followers ?? 0;
  const er = data?.er ?? 0;
  const hasEr = data?.er != null;
  const target = tierTarget(followers);
  const ratio = hasEr && target > 0 ? er / target : 0;
  const verdict = hasEr ? (ratio >= 1 ? { t: 'Strong', c: '#10b981' } : ratio >= 0.6 ? { t: 'Average', c: '#f59e0b' } : { t: 'Low', c: '#f43f5e' }) : null;

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="grid-bg absolute inset-0 opacity-60" />
          <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full blur-3xl opacity-30" style={{ background: ACCENT }} />
          <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-12 text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold mb-5" style={{ background: ACCENT_SOFT, color: ACCENT }}>
              <Gauge14 /> Free tool
            </span>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-ink-900">Engagement Rate Calculator</h1>
            <p className="mt-4 text-[16px] text-ink-600 max-w-xl mx-auto">Paste an Instagram handle or profile link — we’ll pull the creator’s engagement rate and show how it stacks up against the benchmark for their follower tier.</p>

            <div className="mt-8 max-w-xl mx-auto rounded-2xl bg-white border-2 border-[#e3def9] focus-within:border-[#6C4DF6] shadow-[0_12px_50px_rgba(108,77,246,0.12)] transition-colors p-2 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && calculate()}
                placeholder="@handle or instagram.com/handle"
                className="flex-1 px-4 py-3 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
              />
              <button onClick={calculate} disabled={loading} className="px-6 py-3 text-sm font-semibold text-white bg-ink-900 rounded-xl hover:bg-ink-800 disabled:opacity-50 whitespace-nowrap">{loading ? 'Checking…' : 'Get ER'}</button>
            </div>
            {error && <div className="mt-3 text-sm text-rose-700">{error}</div>}
            <p className="mt-3 text-[12px] text-ink-400">No numbers to enter — just the handle.</p>
          </div>
        </section>

        {/* Result */}
        {data && (
          <section className="max-w-3xl mx-auto px-6 -mt-6 relative z-10">
            <div className="ii-fadeup rounded-2xl bg-white border border-border shadow-[0_12px_40px_rgba(0,0,0,0.08)] p-7">
              <div className="text-[13px] text-ink-500 mb-5 text-center">@{data.handle}{data.display_name ? ` · ${data.display_name}` : ''} · {kfmt(data.followers)} followers</div>
              {hasEr ? (
                <div className="flex flex-col sm:flex-row items-center gap-7">
                  <Ring value={er} ratio={ratio} color={verdict!.c} />
                  <div className="flex-1 w-full">
                    <div className="inline-block px-3 py-1 rounded-full text-[13px] font-semibold text-white mb-3" style={{ background: verdict!.c }}>{verdict!.t} for this tier</div>
                    <div className="text-[13px] text-ink-600">Tier benchmark ≈ <span className="font-semibold">{target.toFixed(1)}%</span> — this creator sits at <span className="font-semibold text-ink-900">{(ratio * 100).toFixed(0)}%</span> of it.</div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <Stat label="Followers" value={kfmt(data.followers)} delay={0.15} />
                      <Stat label="Avg likes" value={data.avg_likes != null ? kfmt(data.avg_likes) : '—'} delay={0.25} />
                      <Stat label="Avg comments" value={data.avg_comments != null ? kfmt(data.avg_comments) : '—'} delay={0.35} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <div className="text-[15px] font-semibold text-ink-900">No engagement data on file for @{data.handle}</div>
                  <p className="mt-2 text-[13px] text-ink-500 max-w-md mx-auto">We don’t have recent likes/comments for this creator yet. If they connect Instagram, we show a verified reach-based ER below.</p>
                </div>
              )}

              {verified && (
                <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="text-[12px] font-semibold text-emerald-700">✓ Verified · reach-based</div>
                  <div className="mt-1 text-[22px] font-bold tabular-nums text-emerald-700">{verified.er_pct.toFixed(1)}%</div>
                  <div className="text-[11px] text-emerald-700/80">of reach engaged · avg reach {verified.avg_reach.toLocaleString('en-IN')} · {verified.posts} connected posts</div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* How it works */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-ink-900">How engagement rate is calculated</h2>
              <p className="mt-3 text-[15px] text-ink-600 leading-relaxed">Engagement rate is the share of a creator’s audience that actually interacts with their posts. We use the standard reach-agnostic formula:</p>
              <div className="mt-4 rounded-xl border border-border bg-[#f7f7fb] px-5 py-4 text-[14px] text-ink-800 font-medium">
                ER = (avg likes + avg comments) ÷ followers × 100
              </div>
              <p className="mt-4 text-[14px] text-ink-500 leading-relaxed">Raw ER alone is misleading — a 50K creator and a 2M creator are held to very different standards. That’s why we compare against a <span className="font-medium text-ink-700">tier benchmark</span>.</p>
            </div>
            <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border text-[12px] font-semibold uppercase tracking-wider text-ink-400">Healthy ER by follower tier</div>
              {TIERS.map((t) => (
                <div key={t.tier} className="flex items-center justify-between px-5 py-3 border-b border-border-soft last:border-0">
                  <span className="text-[14px] text-ink-700">{t.tier}</span>
                  <span className="text-[14px] font-semibold tabular-nums" style={{ color: ACCENT }}>{t.er}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-5xl mx-auto px-6 pb-20">
          <div className="rounded-3xl px-8 py-12 text-center text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Find creators who actually engage</h2>
            <p className="mt-2 text-[15px] text-white/85 max-w-xl mx-auto">Influencer Intel ranks thousands of creators by tier-adjusted engagement and quality — so you shortlist the ones that convert.</p>
            <a href="/lander" className="inline-block mt-6 px-6 py-3 rounded-xl bg-white text-[14px] font-semibold" style={{ color: ACCENT }}>Explore the platform</a>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

function lighten(hex: string, amt = 0.4): string {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.round(r + (255 - r) * amt);
  g = Math.round(g + (255 - g) * amt);
  b = Math.round(b + (255 - b) * amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function Ring({ value, ratio, color }: { value: number; ratio: number; color: string }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const target = clamp(ratio, 0, 1);
  // Animate the fill + number from 0 on mount (easeOutCubic).
  const [fill, setFill] = useState(0);
  const [num, setNum] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 1000;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setFill(target * e);
      setNum(value * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, value]);
  const off = circ * (1 - fill);
  const gid = `ring-${color.replace('#', '')}`;
  return (
    <div className="relative w-[164px] h-[164px] shrink-0">
      <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color} />
            <stop offset="1" stopColor={lighten(color)} />
          </linearGradient>
        </defs>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef0f6" strokeWidth="13" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={off}
          style={{ filter: `drop-shadow(0 0 7px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-[38px] font-bold tabular-nums leading-none" style={{ color }}>{num.toFixed(2)}%</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-1.5">engagement</div>
        </div>
      </div>
    </div>
  );
}

function Gauge14() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 18a9 9 0 1 1 17 0" /><path d="M12 18l4.5-5.5" /></svg>);
}

function Stat({ label, value, delay = 0 }: { label: string; value: string; delay?: number }) {
  return (
    <div
      className="rounded-lg border border-border bg-[#fafafc] px-2 py-2 text-center transition-colors hover:border-[#d9d2f7]"
      style={{ animation: `ii-countup .5s ${delay}s both` }}
    >
      <div className="text-[15px] font-bold tabular-nums text-ink-900">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}

const TIERS = [
  { tier: 'Nano (<10K)', er: '6%+' },
  { tier: 'Micro (10K–50K)', er: '3.5–4.5%' },
  { tier: 'Mid (50K–100K)', er: '2.5%' },
  { tier: 'Macro (100K–500K)', er: '1.8%' },
  { tier: 'Mega (500K–1M)', er: '1.3%' },
  { tier: 'Celebrity (1M+)', er: '1%' },
];
