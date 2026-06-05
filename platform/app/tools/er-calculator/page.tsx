'use client';

import { useState } from 'react';
import { MarketingNav, ACCENT } from '@/components/marketing';

const tierTarget = (f: number): number => (f >= 1e6 ? 1 : f >= 5e5 ? 1.3 : f >= 1e5 ? 1.8 : f >= 5e4 ? 2.5 : f >= 2e4 ? 3.5 : f >= 1e4 ? 4.5 : 6);

export default function ERCalculator() {
  const [handle, setHandle] = useState('');
  const [followers, setFollowers] = useState('');
  const [likes, setLikes] = useState('');
  const [comments, setComments] = useState('');
  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function lookup() {
    if (!handle.trim()) return;
    setLooking(true);
    setNote(null);
    try {
      const r = await fetch(`/api/creators?q=${encodeURIComponent(handle.trim().replace(/^@/, ''))}&limit=1`);
      const d = await r.json();
      const c = (d.creators ?? [])[0];
      if (!c) { setNote('Not found in our database — enter the numbers manually.'); return; }
      setFollowers(String(c.follower_count ?? ''));
      setLikes(String(c.avg_likes ?? ''));
      setComments(String(c.avg_comments ?? ''));
      setNote(`Loaded @${c.handle}${c.display_name ? ` · ${c.display_name}` : ''}`);
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
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Free tool</div>
        <h1 className="text-3xl font-bold text-ink-900 mb-2">Engagement Rate Calculator</h1>
        <p className="text-[15px] text-ink-600 mb-7">Look up a creator or punch in the numbers to get their engagement rate and how it stacks up for their tier.</p>

        <div className="rounded-2xl bg-white border border-border shadow-card p-5">
          <div className="flex gap-2 mb-5">
            <input value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="@handle (optional lookup)" className={inp} />
            <button onClick={lookup} disabled={looking} className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 whitespace-nowrap">{looking ? '…' : 'Look up'}</button>
          </div>
          {note && <div className="-mt-3 mb-4 text-[12px] text-ink-500">{note}</div>}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Followers"><input type="number" value={followers} onChange={(e) => setFollowers(e.target.value)} className={inp} /></Field>
            <Field label="Avg likes"><input type="number" value={likes} onChange={(e) => setLikes(e.target.value)} className={inp} /></Field>
            <Field label="Avg comments"><input type="number" value={comments} onChange={(e) => setComments(e.target.value)} className={inp} /></Field>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-white border border-border shadow-card p-6 text-center">
          <div className="text-[11px] uppercase tracking-wider text-ink-400">Engagement rate</div>
          <div className="text-5xl font-bold tabular-nums mt-1" style={{ color: ACCENT }}>{er.toFixed(2)}%</div>
          {verdict && (
            <>
              <div className="mt-3 inline-block px-3 py-1 rounded-full text-[13px] font-medium text-white" style={{ background: verdict.c }}>{verdict.t} for this tier</div>
              <div className="mt-4 text-[12px] text-ink-500">Tier benchmark ≈ {target.toFixed(1)}% · this creator is at {(ratio * 100).toFixed(0)}% of it</div>
              <div className="mt-2 h-2 rounded-full bg-[#eef] overflow-hidden">
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: verdict.c }} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[12px] text-ink-500 mb-1 block">{label}</span>{children}</label>;
}
