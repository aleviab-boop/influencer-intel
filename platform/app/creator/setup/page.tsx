'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface ChecklistItem { key: string; label: string; hint: string; done: boolean; weight: number; href: string }
interface Completeness {
  available: boolean;
  score: number;
  grade: 'complete' | 'strong' | 'getting-there' | 'just-started';
  done_count: number;
  total_count: number;
  headline: string;
  next: { label: string; hint: string; href: string } | null;
  items: ChecklistItem[];
}

const withHandle = (href: string, handle: string | null): string => {
  if (!handle) return href;
  const q = `handle=${encodeURIComponent(handle.replace(/^@/, ''))}`;
  return href + (href.includes('?') ? '&' : '?') + q;
};

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <Setup />
    </Suspense>
  );
}

function Setup() {
  const [handle, setHandle] = useState<string | null>(null);
  const [data, setData] = useState<Completeness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    const qs = h ? `?handle=${encodeURIComponent(h.replace(/^@/, ''))}` : '';
    fetch(`/api/creator/setup${qs}`)
      .then((r) => r.json())
      .then((d: Completeness) => setData(d))
      .catch(() => setData({ available: false } as Completeness))
      .finally(() => setLoading(false));
  }, []);

  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator';
  const r = 52, circ = 2 * Math.PI * r;
  const score = data?.score ?? 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ink-900">Get brand-ready</h1>
        <p className="mt-1.5 text-[14px] text-ink-600">Complete your profile so brands can find, trust and book you.</p>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <h2 className="text-[16px] font-semibold text-ink-900">Profile not found</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500">Open the portal with your handle to see your setup checklist.</p>
          </div>
        ) : (
          <>
            {/* Score dial + headline */}
            <div className="mt-6 rounded-2xl bg-white border border-border shadow-card p-6 flex items-center gap-6">
              <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
                <svg width="128" height="128" viewBox="0 0 128 128">
                  <circle cx="64" cy="64" r={r} fill="none" stroke="#eee9fb" strokeWidth="12" />
                  <circle cx="64" cy="64" r={r} fill="none" stroke={ACCENT} strokeWidth="12" strokeLinecap="round"
                    strokeDasharray={`${(score / 100) * circ} ${circ}`} transform="rotate(-90 64 64)" />
                </svg>
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <div className="text-[28px] font-bold tabular-nums leading-none" style={{ color: ACCENT }}>{score}%</div>
                    <div className="text-[10.5px] uppercase tracking-wide text-ink-400 mt-1">complete</div>
                  </div>
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[16px] font-bold text-ink-900">{data.headline}</div>
                <div className="text-[13px] text-ink-500 mt-1">{data.done_count} of {data.total_count} steps done</div>
                {data.next && (
                  <Link href={withHandle(data.next.href, handle)}
                    className="mt-3 inline-block px-4 py-2 text-[13px] font-semibold text-white rounded-xl"
                    style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                    Next: {data.next.label} →
                  </Link>
                )}
              </div>
            </div>

            {/* Checklist */}
            <div className="mt-5 space-y-2.5">
              {data.items.map((it) => (
                <Link key={it.key} href={withHandle(it.href, handle)}
                  className="flex items-start gap-3.5 rounded-2xl bg-white border border-border shadow-card p-4 hover:border-[#d9d4f5] transition-colors">
                  <div className="mt-0.5 w-6 h-6 shrink-0 rounded-full grid place-items-center border-2"
                    style={it.done ? { background: '#16a34a', borderColor: '#16a34a' } : { borderColor: '#d6d3e8' }}>
                    {it.done && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold" style={{ color: it.done ? '#8a8798' : '#1a1a2e', textDecoration: it.done ? 'line-through' : 'none' }}>{it.label}</div>
                    <div className="text-[12.5px] text-ink-400">{it.hint}</div>
                  </div>
                  {!it.done && (
                    <svg className="mt-1.5 shrink-0 text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                  )}
                </Link>
              ))}
            </div>

            {data.grade === 'complete' && (
              <div className="mt-5 rounded-2xl p-4 text-[13px] text-ink-700" style={{ background: ACCENT_SOFT }}>
                Everything\u2019s set. Keep your bio and payout details current, and your media kit stays sharp.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
