'use client';

import { useEffect, useState, Suspense, use } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Draft { key: 'accept' | 'counter' | 'clarify'; label: string; body: string }
interface DealBrief {
  available: boolean;
  id: string;
  brand: string;
  program: string;
  description: string | null;
  note: string | null;
  deliverables: string[];
  rate: number;
  rate_label: string;
  stage: 'invited' | 'in_progress' | 'awaiting_payment' | 'paid';
  stage_label: string;
  can_respond: boolean;
  due_date: string | null;
  due_label: string | null;
  days_to_due: number | null;
  timeline: { label: string; value: string }[];
  drafts: Draft[];
}

const STAGE_C: Record<DealBrief['stage'], string> = {
  invited: ACCENT,
  in_progress: ACCENT,
  awaiting_payment: '#d97706',
  paid: '#16a34a',
};

export default function DealBriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <Brief id={id} />
    </Suspense>
  );
}

function Brief({ id }: { id: string }) {
  const [handle, setHandle] = useState<string | null>(null);
  const [data, setData] = useState<DealBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Draft['key']>('accept');
  const [copied, setCopied] = useState(false);
  const [responding, setResponding] = useState<null | 'accept' | 'decline'>(null);
  const [responded, setResponded] = useState<null | 'accepted' | 'declined'>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    fetch(`/api/creator/deals/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d: DealBrief) => {
        setData(d);
        if (d?.can_respond) setActive('accept');
      })
      .catch(() => setData({ available: false } as DealBrief))
      .finally(() => setLoading(false));
  }, [id]);

  const backHref = handle ? `/creator/deals?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator/deals';
  const draft = data?.drafts.find((d) => d.key === active) ?? data?.drafts[0];

  const copy = (): void => {
    if (!draft) return;
    navigator.clipboard?.writeText(draft.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  const respond = async (action: 'accept' | 'decline'): Promise<void> => {
    setResponding(action);
    try {
      const res = await fetch(`/api/creator/deals/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = (await res.json()) as { saved?: boolean };
      if (d?.saved) {
        setResponded(action === 'accept' ? 'accepted' : 'declined');
        // Refresh so accepting reveals the next-step actions (submit / invoice).
        const fresh = await fetch(`/api/creator/deals/${encodeURIComponent(id)}`).then((r) => r.json());
        if (fresh?.available) setData(fresh);
      }
    } catch {
      /* leave the buttons; the creator can retry */
    } finally {
      setResponding(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors duration-200 mb-5">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to deals
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <h2 className="text-[16px] font-semibold text-ink-900">Deal not found</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500">This deal may have been removed or the link is out of date.</p>
            <Link href={backHref} className="inline-block mt-5 text-[13px] font-semibold" style={{ color: ACCENT }}>← Back to your deals</Link>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-ink-900">{data.program}</h1>
                <div className="text-[14px] text-ink-500 mt-0.5">{data.brand}</div>
              </div>
              <span className="shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ color: STAGE_C[data.stage], background: `${STAGE_C[data.stage]}14` }}>
                {data.stage_label}
              </span>
            </div>

            {/* Rate + timeline tiles */}
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="Rate" value={data.rate_label} accent />
              {data.timeline.map((t) => (
                <Tile key={t.label} label={t.label} value={t.value} />
              ))}
            </div>

            {/* Generate invoice */}
            {data.rate > 0 && data.stage !== 'invited' && (
              <Link
                href={`/creator/deals/${encodeURIComponent(data.id)}/invoice${handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : ''}`}
                className="group mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white border border-border shadow-card px-5 py-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold text-ink-900">
                      {data.stage === 'paid' ? 'View invoice' : 'Generate invoice'}
                    </div>
                    <div className="text-[12px] text-ink-400">Brand-ready, with your payout details</div>
                  </div>
                </div>
                <svg className="text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </Link>
            )}

            {/* View agreement / contract */}
            <Link
              href={`/creator/deals/${encodeURIComponent(data.id)}/contract${handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : ''}`}
              className="group mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white border border-border shadow-card px-5 py-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 15l2 2 4-4" /></svg>
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-ink-900">
                    {data.can_respond ? 'Preview agreement' : 'View agreement'}
                  </div>
                  <div className="text-[12px] text-ink-400">Scope, fee & usage terms — ready to save as PDF</div>
                </div>
              </div>
              <svg className="text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </Link>

            {/* Messages */}
            <Link
              href={`/creator/deals/${encodeURIComponent(data.id)}/messages${handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : ''}`}
              className="group mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white border border-border shadow-card px-5 py-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /></svg>
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-ink-900">Messages</div>
                  <div className="text-[12px] text-ink-400">Chat with the brand about this deal</div>
                </div>
              </div>
              <svg className="text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </Link>

            {/* Submit deliverables */}
            {data.stage !== 'invited' && (
              <Link
                href={`/creator/deals/${encodeURIComponent(data.id)}/submit${handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : ''}`}
                className="group mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white border border-border shadow-card px-5 py-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" /></svg>
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold text-ink-900">Submit deliverables</div>
                    <div className="text-[12px] text-ink-400">Attach your live post links to close out the deal</div>
                  </div>
                </div>
                <svg className="text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </Link>
            )}

            {/* Brief */}
            {(data.description || data.note) && (
              <section className="mt-6 rounded-2xl bg-white border border-border shadow-card p-5">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-2">The brief</h2>
                {data.description && <p className="text-[14px] text-ink-700 leading-relaxed whitespace-pre-line">{data.description}</p>}
                {data.note && <p className="mt-3 text-[13px] text-ink-500 leading-relaxed whitespace-pre-line border-l-2 pl-3" style={{ borderColor: ACCENT_SOFT }}>{data.note}</p>}
              </section>
            )}

            {/* Deliverables */}
            {data.deliverables.length > 0 && (
              <section className="mt-4 rounded-2xl bg-white border border-border shadow-card p-5">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Deliverables</h2>
                <ul className="space-y-2">
                  {data.deliverables.map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[14px] text-ink-700">
                      <span className="mt-1 w-4 h-4 shrink-0 rounded-[5px] border-2" style={{ borderColor: '#d6d3e8' }} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Accept / decline the invite */}
            {responded ? (
              <section
                className="mt-4 rounded-2xl border p-4 flex items-center gap-3"
                style={responded === 'accepted'
                  ? { background: '#ecfdf5', borderColor: '#a7f3d0' }
                  : { background: '#f8fafc', borderColor: '#e2e8f0' }}
              >
                <span
                  className="w-8 h-8 rounded-full grid place-items-center text-white shrink-0"
                  style={{ background: responded === 'accepted' ? '#16a34a' : '#94a3b8' }}
                >
                  {responded === 'accepted' ? '✓' : '–'}
                </span>
                <div className="text-[13.5px] text-ink-700">
                  {responded === 'accepted'
                    ? <>You accepted this deal — <strong>{data.brand}</strong> has been notified. Submit your deliverables when they’re live.</>
                    : <>You declined this deal — <strong>{data.brand}</strong> has been notified.</>}
                </div>
              </section>
            ) : data.can_respond ? (
              <section className="mt-4 rounded-2xl bg-white border border-border shadow-card p-5">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400">Respond to this invite</h2>
                <p className="mt-1 text-[12.5px] text-ink-500">
                  Accept to lock in the deal, or decline to pass. {data.brand} is notified either way.
                </p>
                <div className="mt-3 flex gap-2.5">
                  <button
                    onClick={() => respond('accept')}
                    disabled={!!responding}
                    className="text-[13.5px] font-semibold px-5 py-2.5 rounded-xl text-white disabled:opacity-60 transition-all hover:brightness-105"
                    style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                  >
                    {responding === 'accept' ? 'Accepting…' : 'Accept invite'}
                  </button>
                  <button
                    onClick={() => respond('decline')}
                    disabled={!!responding}
                    className="text-[13.5px] font-semibold px-5 py-2.5 rounded-xl border text-ink-600 disabled:opacity-60 hover:bg-[#faf9ff] transition-colors"
                    style={{ borderColor: '#e6e4f0' }}
                  >
                    {responding === 'decline' ? 'Declining…' : 'Decline'}
                  </button>
                </div>
              </section>
            ) : null}

            {/* Response drafts */}
            <section className="mt-4 rounded-2xl bg-white border border-border shadow-card p-5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400">
                  {data.can_respond ? 'Reply to the brand' : 'Message templates'}
                </h2>
                <button onClick={copy} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: ACCENT }}>
                  {copied ? '✓ Copied' : 'Copy message'}
                </button>
              </div>
              <p className="mt-1 text-[12px] text-ink-400">
                Ready-to-send drafts — copy, tweak the details, and paste into your reply.
              </p>

              <div className="mt-3 flex gap-2">
                {data.drafts.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => setActive(d.key)}
                    className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                    style={active === d.key
                      ? { color: '#fff', background: ACCENT, borderColor: ACCENT }
                      : { color: '#4b4b63', background: '#fff', borderColor: '#e6e4f0' }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 rounded-xl border border-border bg-[#fafaff] p-4 text-[13.5px] text-ink-700 leading-relaxed whitespace-pre-line">
                {draft?.body}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-white shadow-card px-4 py-3.5">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 text-[15px] font-bold leading-tight" style={accent ? { color: ACCENT } : undefined}>{value}</div>
    </div>
  );
}
