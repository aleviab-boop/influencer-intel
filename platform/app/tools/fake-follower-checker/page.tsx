'use client';

import { useState } from 'react';
import { MarketingNav, ACCENT } from '@/components/marketing';

const tierTarget = (f: number): number => (f >= 1e6 ? 1 : f >= 5e5 ? 1.3 : f >= 1e5 ? 1.8 : f >= 5e4 ? 2.5 : f >= 2e4 ? 3.5 : f >= 1e4 ? 4.5 : 6);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

interface Result {
  authenticity: number;
  band: { t: string; c: string };
  signals: { label: string; ok: boolean; detail: string }[];
}

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
      const r = await fetch(`/api/creators?q=${encodeURIComponent(handle.trim().replace(/^@/, ''))}&limit=1`);
      const d = await r.json();
      const c = (d.creators ?? [])[0];
      if (!c) { setError('Creator not found in our database. Try another handle.'); return; }

      const followers = Number(c.follower_count) || 0;
      const following = Number(c.following_count) || 0;
      const er = c.engagement_rate != null ? Number(c.engagement_rate) * 100 : followers > 0 ? ((Number(c.avg_likes) || 0) + (Number(c.avg_comments) || 0)) / followers * 100 : 0;
      const cred = c.cred_score != null ? Number(c.cred_score) : null;

      const target = tierTarget(followers);
      const erScore = clamp((er / Math.max(0.1, target)) * 100, 0, 100);              // engagement health
      const ff = following > 0 ? followers / following : followers > 0 ? 999 : 1;
      const ffScore = clamp(ff >= 1 ? 70 + Math.min(30, (ff - 1) * 8) : ff * 70, 0, 100);
      const commentRatio = (Number(c.avg_likes) || 0) > 0 ? (Number(c.avg_comments) || 0) / (Number(c.avg_likes) || 1) : 0;
      const commentScore = clamp((commentRatio / 0.015) * 100, 0, 100);

      const parts = cred != null ? [erScore * 0.4, commentScore * 0.2, ffScore * 0.2, cred * 0.2] : [erScore * 0.5, commentScore * 0.25, ffScore * 0.25];
      const authenticity = Math.round(parts.reduce((a, b) => a + b, 0));
      const band = authenticity >= 80 ? { t: 'Low risk', c: '#10b981' } : authenticity >= 55 ? { t: 'Medium risk', c: '#f59e0b' } : { t: 'High risk', c: '#f43f5e' };

      setMeta(`@${c.handle}${c.display_name ? ` · ${c.display_name}` : ''} · ${followers.toLocaleString('en-IN')} followers`);
      setResult({
        authenticity,
        band,
        signals: [
          { label: 'Engagement vs tier', ok: er >= target * 0.6, detail: `${er.toFixed(2)}% (benchmark ${target.toFixed(1)}%)` },
          { label: 'Comment authenticity', ok: commentRatio >= 0.005, detail: `${(commentRatio * 100).toFixed(2)}% comments-per-like` },
          { label: 'Follower / following ratio', ok: ff >= 1, detail: ff >= 999 ? 'follows almost no one' : `${ff.toFixed(1)}×` },
          ...(cred != null ? [{ label: 'Credibility score', ok: cred >= 70, detail: `${Math.round(cred)}/100` }] : []),
        ],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Free tool</div>
        <h1 className="text-3xl font-bold text-ink-900 mb-2">Fake Follower Checker</h1>
        <p className="text-[15px] text-ink-600 mb-7">Enter a creator’s handle to estimate how authentic their audience is — based on engagement, comment quality and follower ratios from our scored database.</p>

        <div className="rounded-2xl bg-white border border-border shadow-card p-5">
          <div className="flex gap-2">
            <input value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} placeholder="@handle" className="flex-1 px-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900" />
            <button onClick={check} disabled={loading} className="px-5 py-2.5 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 whitespace-nowrap">{loading ? 'Checking…' : 'Check'}</button>
          </div>
          {error && <div className="mt-3 text-sm text-rose-700">{error}</div>}
        </div>

        {result && (
          <div className="mt-5 rounded-2xl bg-white border border-border shadow-card p-6">
            {meta && <div className="text-[13px] text-ink-500 mb-4">{meta}</div>}
            <div className="flex items-center gap-5">
              <div className="text-center">
                <div className="text-5xl font-bold tabular-nums" style={{ color: result.band.c }}>{result.authenticity}</div>
                <div className="text-[11px] uppercase tracking-wider text-ink-400">authenticity</div>
              </div>
              <div className="flex-1">
                <div className="inline-block px-3 py-1 rounded-full text-[13px] font-medium text-white mb-2" style={{ background: result.band.c }}>{result.band.t}</div>
                <div className="h-2.5 rounded-full bg-[#eef] overflow-hidden">
                  <div className="h-2.5 rounded-full" style={{ width: `${result.authenticity}%`, background: result.band.c }} />
                </div>
                <div className="mt-1 text-[12px] text-ink-400">~{100 - result.authenticity}% of the audience looks low-quality / inactive</div>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {result.signals.map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-[13px]">
                  <span className={`w-4 h-4 rounded-full grid place-items-center text-white text-[10px] ${s.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}>{s.ok ? '✓' : '!'}</span>
                  <span className="text-ink-700">{s.label}</span>
                  <span className="ml-auto text-ink-400">{s.detail}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[12px] text-ink-400">Heuristic estimate from public engagement signals — not a definitive audit.</p>
          </div>
        )}
      </main>
    </div>
  );
}
