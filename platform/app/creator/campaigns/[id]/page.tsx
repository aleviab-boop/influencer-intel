'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Campaign { id: string; name: string; description: string | null; budget: number | string | null; recruit_count: number; created_at?: string }

export default function CampaignDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  const [handle, setHandle] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const h = typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null;
    setHandle(h);
    (async () => {
      try {
        const camps = await fetch('/api/creator/campaigns').then((r) => r.json());
        const c = (camps.campaigns ?? []).find((x: Campaign) => x.id === id) ?? null;
        if (!c) { setNotFound(true); return; }
        setCampaign(c);
        if (h) {
          const apps = await fetch(`/api/creator/applications?handle=${encodeURIComponent(h)}`).then((r) => r.json());
          setApplied((apps.applications ?? []).some((a: { program_id: string }) => a.program_id === id));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function apply() {
    if (!handle || applied || applying) return;
    setApplying(true);
    try {
      await fetch('/api/creator/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, program_id: id }),
      });
      setApplied(true);
    } finally {
      setApplying(false);
    }
  }

  const hasBudget = campaign?.budget != null && Number(campaign.budget) > 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <Link href="/creator" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : notFound || !campaign ? (
          <div className="text-center py-20">
            <h1 className="text-xl font-bold text-ink-900">Campaign not found</h1>
            <p className="mt-2 text-[14px] text-ink-600">This campaign may have closed. Browse the open ones on your dashboard.</p>
            <Link href="/creator" className="inline-block mt-5 px-5 py-2.5 text-sm font-semibold text-white rounded-lg" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>Back to dashboard</Link>
          </div>
        ) : (
          <div className="rounded-3xl bg-white border border-border shadow-card overflow-hidden">
            <div className="h-24" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }} />
            <div className="px-6 sm:px-8 pb-8 -mt-8">
              <div className="rounded-2xl bg-white border border-border shadow-card px-5 py-4">
                <h1 className="text-2xl font-bold text-ink-900">{campaign.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                  {hasBudget && (
                    <span className="px-2.5 py-1 rounded-md font-medium" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                      ₹{Number(campaign.budget).toLocaleString('en-IN')} budget
                    </span>
                  )}
                  <span className="px-2.5 py-1 rounded-md bg-[#f4f4f6] text-ink-500">{campaign.recruit_count} creators on board</span>
                </div>
              </div>

              <div className="mt-6">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-2">About this campaign</h2>
                <p className="text-[15px] text-ink-700 leading-relaxed whitespace-pre-line">
                  {campaign.description || 'A brand campaign looking for creators like you. Apply to express interest — the brand will review your profile and reach out with the brief, deliverables and timeline.'}
                </p>
              </div>

              <div className="mt-6">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-2">What happens next</h2>
                <ol className="space-y-2.5">
                  {['Apply to register your interest', 'The brand reviews your profile & engagement', 'If it’s a fit, they reach out with the full brief', 'Agree deliverables & rate, then create'].map((step, i) => (
                    <li key={step} className="flex items-start gap-3 text-[14px] text-ink-700">
                      <span className="w-6 h-6 shrink-0 rounded-full grid place-items-center text-[12px] font-bold" style={{ background: ACCENT_SOFT, color: ACCENT }}>{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-8">
                {!handle ? (
                  <button onClick={() => router.push('/creator')} className="w-full px-5 py-3 rounded-xl text-[15px] font-semibold text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                    Sign in to apply
                  </button>
                ) : (
                  <button
                    onClick={apply}
                    disabled={applied || applying}
                    className={`w-full px-5 py-3 rounded-xl text-[15px] font-semibold transition-all ${applied ? 'bg-emerald-50 text-emerald-700 cursor-default' : 'text-white hover:brightness-105'}`}
                    style={applied ? undefined : { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                  >
                    {applied ? 'Applied ✓ — the brand has your profile' : applying ? 'Applying…' : 'Apply now'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
