'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Campaign { id: string; name: string; description: string | null; budget: number | string | null; recruit_count: number }
interface Application { program_id: string }

export default function CreatorCampaignsPage() {
  return (
    <Suspense fallback={null}>
      <CreatorCampaigns />
    </Suspense>
  );
}

function CreatorCampaigns() {
  const [handle, setHandle] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadApplied = useCallback(async (h: string) => {
    try {
      const r = await fetch(`/api/creator/applications?handle=${encodeURIComponent(h.replace(/^@/, ''))}`).then((x) => x.json());
      setAppliedIds(new Set((r.applications ?? []).map((a: Application) => a.program_id)));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    (async () => {
      try {
        const c = await fetch('/api/creator/campaigns').then((x) => x.json());
        setCampaigns(c.campaigns ?? []);
        if (h) await loadApplied(h);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadApplied]);

  const apply = useCallback(async (programId: string) => {
    if (!handle) return;
    setApplying(programId);
    try {
      await fetch('/api/creator/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, program_id: programId }),
      });
      await loadApplied(handle);
    } finally {
      setApplying(null);
    }
  }, [handle, loadApplied]);

  const hq = handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '';
  const backHref = handle ? `/creator${hq}` : '/creator';

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5 transition-colors duration-200">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ink-900">Open campaigns</h1>
        <p className="mt-1.5 text-[14px] text-ink-600">Brand campaigns you can apply to right now.</p>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : campaigns.length === 0 ? (
          <div className="mt-8 text-sm text-ink-400 py-16 text-center rounded-2xl border border-dashed border-border bg-white">No open campaigns right now. Check back soon.</div>
        ) : (
          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            {campaigns.map((c) => {
              const applied = appliedIds.has(c.id);
              const hasBudget = c.budget != null && Number(c.budget) > 0;
              return (
                <div key={c.id} className="group rounded-2xl bg-white border border-border shadow-card p-5 flex flex-col transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_48px_rgba(108,77,246,0.16)]">
                  <Link href={`/creator/campaigns/${c.id}`} className="font-semibold text-ink-900 text-[15px] hover:underline" style={{ textDecorationColor: ACCENT }}>{c.name}</Link>
                  <p className="mt-1 text-[13px] text-ink-500 leading-relaxed line-clamp-3 flex-1">{c.description || 'A brand campaign looking for creators like you.'}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                    {hasBudget && (
                      <span className="px-2 py-1 rounded-md font-medium" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                        ₹{Number(c.budget).toLocaleString('en-IN')}
                      </span>
                    )}
                    <span className="px-2 py-1 rounded-md bg-[#f4f4f6] text-ink-500">{c.recruit_count} creators</span>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => apply(c.id)}
                      disabled={applied || applying === c.id}
                      className={`flex-1 px-4 py-2.5 rounded-xl text-[14px] font-semibold transition-all ${applied ? 'bg-emerald-50 text-emerald-700 cursor-default' : 'text-white hover:brightness-105'}`}
                      style={applied ? undefined : { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                    >
                      {applied ? 'Applied ✓' : applying === c.id ? 'Applying…' : 'Apply now'}
                    </button>
                    <Link href={`/creator/campaigns/${c.id}`} className="px-4 py-2.5 rounded-xl text-[14px] font-semibold border border-border hover:bg-[#faf9ff]" style={{ color: ACCENT }}>
                      Details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
