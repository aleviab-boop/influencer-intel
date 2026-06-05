'use client';

import { useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

const tierTarget = (f: number): number => (f >= 1e6 ? 1 : f >= 5e5 ? 1.3 : f >= 1e5 ? 1.8 : f >= 5e4 ? 2.5 : f >= 2e4 ? 3.5 : f >= 1e4 ? 4.5 : 6);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export default function ERCalculator() {
  const [handle, setHandle] = useState('');
  const [followers, setFollowers] = useState('');
  const [likes, setLikes] = useState('');
  const [comments, setComments] = useState('');
  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [verified, setVerified] = useState<{ er_pct: number; cpl_pct: number; posts: number; avg_reach: number } | null>(null);

  async function lookup() {
    if (!handle.trim()) return;
    setLooking(true);
    setNote(null);
    setVerified(null);
    const clean = handle.trim().replace(/^@/, '');
    try {
      const r = await fetch(`/api/creators?q=${encodeURIComponent(clean)}&limit=1`);
      const d = await r.json();
      const c = (d.creators ?? [])[0];
      if (!c) { setNote('Not found in our database — enter the numbers manually.'); return; }
      setFollowers(String(c.follower_count ?? ''));
      setLikes(String(c.avg_likes ?? ''));
      setComments(String(c.avg_comments ?? ''));
      setNote(`Loaded @${c.handle}${c.display_name ? ` · ${c.display_name}` : ''}`);
      // If this creator has connected via Instagram, prefer reach-based (verified) ER.
      fetch(`/api/tools/verified-engagement?handle=${encodeURIComponent(clean)}`)
        .then((x) => x.json())
        .then((v) => { if (v?.verified) setVerified({ er_pct: v.er_pct, cpl_pct: v.cpl_pct, posts: v.posts, avg_reach: v.avg_reach }); })
        .catch(() => {});
    } catch {
      setNote('Lookup failed.');
    } finally {
      setLooking(false);
    }
  }

  const f = Number(followers) || 0;
  const er = f > 0 ? ((Number(likes) || 0) + (Number(comments) || 0)) / f * 100 : 0;
  const target = tierTarget(f);
  const ratio = target > 0 ? er / target : 0;
  const verdict = !f || (!Number(likes) && !Number(comments)) ? null : ratio >= 1 ? { t: 'Strong', c: '#10b981' } : ratio >= 0.6 ? { t: 'Average', c: '#f59e0b' } : { t: 'Low', c: '#f43f5e' };

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
            <p className="mt-4 text-[16px] text-ink-600 max-w-xl mx-auto">Look up any creator or enter the numbers yourself to get their engagement rate — and see how it stacks up against the benchmark for their follower tier.</p>
          </div>
        </section>

        {/* Calculator */}
        <section className="max-w-3xl mx-auto px-6 -mt-6 relative z-10 pb-4">
          <div className="grid md:grid-cols-2 gap-5">
            {/* Inputs */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-5">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Creator data</div>
              <div className="flex gap-2 mb-4">
                <input value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="@handle (auto-fill)" className={inp} />
                <button onClick={lookup} disabled={looking} className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 whitespace-nowrap">{looking ? '…' : 'Look up'}</button>
              </div>
              {note && <div className="-mt-2 mb-3 text-[12px] text-ink-500">{note}</div>}
              <div className="space-y-3">
                <Field label="Followers"><input type="number" value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="0" className={inp} /></Field>
                <Field label="Avg likes per post"><input type="number" value={likes} onChange={(e) => setLikes(e.target.value)} placeholder="0" className={inp} /></Field>
                <Field label="Avg comments per post"><input type="number" value={comments} onChange={(e) => setComments(e.target.value)} placeholder="0" className={inp} /></Field>
              </div>
            </div>

            {/* Result */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-6 flex flex-col items-center justify-center text-center">
              <Ring value={er} ratio={ratio} color={verdict?.c ?? ACCENT} />
              {verdict ? (
                <>
                  <div className="mt-4 inline-block px-3 py-1 rounded-full text-[13px] font-semibold text-white" style={{ background: verdict.c }}>{verdict.t} for this tier</div>
                  <div className="mt-3 text-[12px] text-ink-500">Tier benchmark ≈ {target.toFixed(1)}% — this creator sits at <span className="font-semibold text-ink-700">{(ratio * 100).toFixed(0)}%</span> of it</div>
                </>
              ) : (
                <div className="mt-4 text-[13px] text-ink-400">Enter followers and engagement to see the verdict.</div>
              )}
              {verified && (
                <div className="mt-5 w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><span>✓ Verified · reach-based</span></div>
                  <div className="mt-1 text-[22px] font-bold tabular-nums text-emerald-700">{verified.er_pct.toFixed(1)}%</div>
                  <div className="text-[11px] text-emerald-700/80">of reach engaged · avg reach {verified.avg_reach.toLocaleString('en-IN')} · {verified.posts} connected posts</div>
                  <div className="mt-1.5 text-[11px] text-ink-400">This creator connected via Instagram — measured against people actually reached, not follower count.</div>
                </div>
              )}
            </div>
          </div>
        </section>

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

function Ring({ value, ratio, color }: { value: number; ratio: number; color: string }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - clamp(ratio, 0, 1));
  return (
    <div className="relative w-[150px] h-[150px]">
      <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef0f6" strokeWidth="12" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.22,.61,.36,1)' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-4xl font-bold tabular-nums leading-none" style={{ color }}>{value.toFixed(2)}%</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-1">engagement</div>
        </div>
      </div>
    </div>
  );
}

function Gauge14() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 18a9 9 0 1 1 17 0" /><path d="M12 18l4.5-5.5" /></svg>);
}

const inp = 'w-full px-3 py-2 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[12px] text-ink-500 mb-1 block">{label}</span>{children}</label>;
}

const TIERS = [
  { tier: 'Nano (<10K)', er: '6%+' },
  { tier: 'Micro (10K–50K)', er: '3.5–4.5%' },
  { tier: 'Mid (50K–100K)', er: '2.5%' },
  { tier: 'Macro (100K–500K)', er: '1.8%' },
  { tier: 'Mega (500K–1M)', er: '1.3%' },
  { tier: 'Celebrity (1M+)', er: '1%' },
];
