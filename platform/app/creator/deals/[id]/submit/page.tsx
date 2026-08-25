'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

type Platform = 'instagram' | 'youtube' | 'tiktok' | 'x' | 'facebook' | 'link';
interface SubmissionEntry {
  id: string;
  label: string | null;
  url: string;
  platform: Platform;
  note: string | null;
  created_at: string;
  domain: string;
  when_label: string;
  review: { state: 'approved' | 'changes'; at: string; comment: string | null } | null;
}
interface DeliverableProgress { label: string; covered: boolean }
interface SubmissionView {
  available: boolean;
  deal_id: string;
  program: string;
  brand: string;
  stage: 'invited' | 'in_progress' | 'complete' | 'paid';
  deliverables: DeliverableProgress[];
  submissions: SubmissionEntry[];
  required: number;
  submitted: number;
  progress_pct: number;
  all_covered: boolean;
  can_submit: boolean;
  due_label: string | null;
  headline: string;
  next_action: string;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', facebook: 'Facebook', link: 'Link',
};
const PLATFORM_C: Record<Platform, string> = {
  instagram: '#c13584', youtube: '#ff0000', tiktok: '#111', x: '#111', facebook: '#1877f2', link: ACCENT,
};

export default function SubmitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Submit id={id} />;
}

function Submit({ id }: { id: string }) {
  const [handle, setHandle] = useState<string | null>(null);
  const [data, setData] = useState<SubmissionView | null>(null);
  const [loading, setLoading] = useState(true);

  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const base = `/api/creator/deals/${encodeURIComponent(id)}/submissions`;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    fetch(base)
      .then((r) => r.json())
      .then((d: SubmissionView) => setData(d))
      .catch(() => setData({ available: false } as SubmissionView))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const add = async (): Promise<void> => {
    if (!url.trim()) { setErr('Paste the live post URL.'); return; }
    setAdding(true); setErr(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label: label || undefined, note: note || undefined }),
      });
      const d = (await res.json()) as SubmissionView & { reason?: string; error?: string };
      if (d.available) {
        setData(d); setUrl(''); setLabel(''); setNote('');
      } else {
        setErr(d.error || 'Couldn\u2019t save that link. Try again.');
      }
    } catch {
      setErr('Network error — try again.');
    } finally {
      setAdding(false);
    }
  };

  const remove = async (sid: string): Promise<void> => {
    setBusyId(sid);
    try {
      const res = await fetch(`${base}?sid=${encodeURIComponent(sid)}`, { method: 'DELETE' });
      const d = (await res.json()) as SubmissionView;
      if (d.available) setData(d);
    } catch {
      /* leave as-is */
    } finally {
      setBusyId(null);
    }
  };

  const dealHref = `/creator/deals/${encodeURIComponent(id)}${handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : ''}`;

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <Link href={dealHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors duration-200 mb-5">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to deal
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <h2 className="text-[16px] font-semibold text-ink-900">Deal not found</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500">We couldn\u2019t load this deal. Head back to your deals list.</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-ink-900">Submit deliverables</h1>
            <p className="mt-1 text-[14px] text-ink-500">{data.program} · {data.brand}</p>
            <p className="mt-2 text-[14px] text-ink-700">{data.headline}</p>

            {/* Progress bar */}
            <div className="mt-5 rounded-2xl bg-white border border-border shadow-card p-5">
              <div className="flex items-center justify-between text-[12.5px] mb-2">
                <span className="font-semibold text-ink-700">{data.submitted} of {data.required || data.submitted} submitted</span>
                <span className="tabular-nums text-ink-400">{data.progress_pct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-[#f0eefb] overflow-hidden">
                <div className="h-full rounded-full transition-[width]" style={{ width: `${data.progress_pct}%`, background: data.all_covered ? '#16a34a' : `linear-gradient(90deg, ${ACCENT}, #9b7bff)` }} />
              </div>

              {data.deliverables.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {data.deliverables.map((d, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[13.5px]">
                      <span className="mt-0.5 w-4 h-4 shrink-0 rounded-[5px] grid place-items-center border-2" style={{ borderColor: d.covered ? '#16a34a' : '#d6d3e8', background: d.covered ? '#16a34a' : 'transparent' }}>
                        {d.covered && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                      </span>
                      <span className={d.covered ? 'text-ink-400 line-through' : 'text-ink-700'}>{d.label}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 rounded-lg px-3 py-2.5 text-[12.5px] text-ink-700" style={{ background: data.all_covered ? '#ecfdf3' : ACCENT_SOFT }}>
                <span className="font-semibold" style={{ color: data.all_covered ? '#16a34a' : ACCENT }}>Next · </span>
                {data.next_action}
              </div>
            </div>

            {/* Add form */}
            {data.can_submit ? (
              <div className="mt-5 rounded-2xl bg-white border border-border shadow-card p-5">
                <div className="text-[13px] font-semibold text-ink-800 mb-3">Attach a live post</div>
                <div className="space-y-3">
                  <div>
                    <input
                      value={url}
                      onChange={(e) => { setUrl(e.target.value); setErr(null); }}
                      placeholder="https://instagram.com/p/…"
                      className="w-full rounded-lg border px-3 py-2.5 text-[14px] text-ink-900 focus:outline-none focus:border-[#b9aef0]"
                      style={{ borderColor: err ? '#fca5a5' : undefined }}
                    />
                    {err && <div className="mt-1 text-[11.5px] text-[#dc2626]">{err}</div>}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value.slice(0, 120))}
                      placeholder="Which deliverable? (optional)"
                      list="deliverable-options"
                      className="w-full rounded-lg border border-border px-3 py-2.5 text-[13.5px] text-ink-900 focus:outline-none focus:border-[#b9aef0]"
                    />
                    <datalist id="deliverable-options">
                      {data.deliverables.map((d, i) => <option key={i} value={d.label} />)}
                    </datalist>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, 280))}
                      placeholder="Note for the brand (optional)"
                      className="w-full rounded-lg border border-border px-3 py-2.5 text-[13.5px] text-ink-900 focus:outline-none focus:border-[#b9aef0]"
                    />
                  </div>
                  <button onClick={add} disabled={adding || !url.trim()} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-60 transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                    {adding ? 'Adding…' : 'Attach link'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl p-4 text-[13px] text-ink-600 bg-white border border-border">
                {data.stage === 'invited'
                  ? 'Accept this deal first — then you can attach your live posts here.'
                  : 'This deal is closed. Links below are kept for your records.'}
              </div>
            )}

            {/* Submitted links */}
            <div className="mt-5">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">
                Attached links <span className="text-ink-300">({data.submissions.length})</span>
              </h2>
              {data.submissions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-white px-5 py-8 text-center text-[13.5px] text-ink-500">
                  No posts attached yet. Paste a live URL above once your content is up.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data.submissions.map((s) => (
                    <div key={s.id} className="flex items-start gap-3 rounded-xl bg-white border border-border shadow-card px-4 py-3">
                      <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md shrink-0" style={{ color: '#fff', background: PLATFORM_C[s.platform] }}>
                        {PLATFORM_LABEL[s.platform]}
                      </span>
                      <div className="min-w-0 flex-1">
                        {s.label && <div className="text-[13px] font-semibold text-ink-900 truncate">{s.label}</div>}
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-[#6C4DF6] hover:underline break-all">{s.url}</a>
                        <div className="text-[11.5px] text-ink-400 mt-0.5">
                          {s.when_label}{s.note ? ` · ${s.note}` : ''}
                        </div>
                        {s.review && (
                          <div className="mt-1.5">
                            <span
                              className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
                              style={s.review.state === 'approved'
                                ? { color: '#16a34a', background: '#ecfdf3' }
                                : { color: '#d97706', background: '#fffbeb' }}
                            >
                              {s.review.state === 'approved' ? 'Approved by brand' : 'Changes requested'}
                            </span>
                            {s.review.comment && <p className="mt-1 text-[12px] text-ink-600 border-l-2 border-border pl-2">{s.review.comment}</p>}
                          </div>
                        )}
                      </div>
                      {data.can_submit && (
                        <button onClick={() => remove(s.id)} disabled={busyId === s.id} className="shrink-0 text-ink-300 hover:text-[#dc2626] disabled:opacity-40" aria-label="Remove link">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
