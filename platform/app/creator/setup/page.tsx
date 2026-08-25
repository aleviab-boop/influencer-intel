'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

interface ChecklistItem { key: string; label: string; hint: string; done: boolean; weight: number; href: string }
interface DataExportSummary {
  username: string | null;
  display_name: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  posts_last_30d: number | null;
  posts_last_90d: number | null;
  avg_gap_days: number | null;
  first_post_at: string | null;
  last_post_at: string | null;
  imported_at: string;
}
interface Verification {
  tier: 'oauth' | 'screenshot' | 'public' | 'self_reported' | 'none';
  label: string;
  description: string;
  verified: boolean;
  strength: number;
  can_upgrade: boolean;
  next_hint: string | null;
}
interface Completeness {
  available: boolean;
  score: number;
  grade: 'complete' | 'strong' | 'getting-there' | 'just-started';
  done_count: number;
  total_count: number;
  headline: string;
  next: { label: string; hint: string; href: string } | null;
  items: ChecklistItem[];
  verification?: Verification | null;
  handle_verified?: boolean;
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
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ownCode, setOwnCode] = useState<string | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownChecking, setOwnChecking] = useState(false);
  const [ownMsg, setOwnMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exportSummary, setExportSummary] = useState<DataExportSummary | null>(null);

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
    // Prefill any prior data-export import so we can show "last imported …".
    fetch(`/api/creator/data-export${qs}`)
      .then((r) => r.json())
      .then((d: { available?: boolean; summary?: DataExportSummary | null }) => {
        if (d?.available && d.summary) setExportSummary(d.summary);
      })
      .catch(() => {});
  }, []);

  // Public auto-fill: pulls the creator's own public IG profile (login-free, no
  // Meta App Review) to confirm reach and lift their verification tier.
  const enrich = async () => {
    if (enriching) return;
    setEnriching(true);
    setEnrichMsg(null);
    const qs = handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '';
    try {
      const r = await fetch(`/api/creator/profile/enrich${qs}`, { method: 'POST' }).then((res) => res.json());
      if (r?.ok) {
        const f = Number(r.followers) || 0;
        setEnrichMsg({ ok: true, text: `Verified from your public profile — ${f.toLocaleString('en-IN')} followers on file.` });
        const d = await fetch(`/api/creator/setup${qs}`).then((res) => res.json());
        setData(d);
      } else {
        setEnrichMsg({
          ok: false,
          text: r?.reason === 'no_handle'
            ? 'Add your Instagram handle in Settings first.'
            : "Couldn't reach Instagram just now — try again, or keep the numbers you entered.",
        });
      }
    } catch {
      setEnrichMsg({ ok: false, text: 'Something went wrong. Please try again.' });
    } finally {
      setEnriching(false);
    }
  };

  // Bio-code ownership check: prove the creator controls the IG handle by
  // dropping a one-time code in their public bio — no Meta, no OAuth.
  const startOwnership = async () => {
    setOwnOpen(true);
    setOwnMsg(null);
    if (ownCode) return;
    const qs = handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '';
    try {
      const r = await fetch(`/api/creator/verify-handle${qs}`).then((res) => res.json());
      if (r?.available && r.code) setOwnCode(r.code);
      else setOwnMsg({ ok: false, text: 'Add your Instagram handle in Settings first.' });
    } catch {
      setOwnMsg({ ok: false, text: 'Couldn’t start verification. Please try again.' });
    }
  };

  const confirmOwnership = async () => {
    if (ownChecking) return;
    setOwnChecking(true);
    setOwnMsg(null);
    const qs = handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '';
    try {
      const r = await fetch(`/api/creator/verify-handle${qs}`, { method: 'POST' }).then((res) => res.json());
      if (r?.ok) {
        setOwnMsg({ ok: true, text: 'Ownership confirmed — brands can see you control this handle.' });
        const d = await fetch(`/api/creator/setup${qs}`).then((res) => res.json());
        setData(d);
      } else {
        setOwnMsg({
          ok: false,
          text: r?.reason === 'code_not_found'
            ? 'We couldn’t find the code in your bio yet. Save it on Instagram, then check again.'
            : r?.reason === 'no_handle'
            ? 'Add your Instagram handle in Settings first.'
            : 'Couldn’t reach Instagram just now — try again in a moment.',
        });
      }
    } catch {
      setOwnMsg({ ok: false, text: 'Something went wrong. Please try again.' });
    } finally {
      setOwnChecking(false);
    }
  };

  // DYI export upload: creator hands us their own Instagram data ZIP; we parse
  // it server-side for exact follower/following counts + posting cadence. No Meta.
  const uploadExport = async (file: File) => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportMsg(null);
    const qs = handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/creator/data-export${qs}`, { method: 'POST', body: fd }).then((res) => res.json());
      if (r?.ok && r.summary) {
        const s = r.summary as DataExportSummary;
        setExportSummary(s);
        const f = Number(s.followers) || 0;
        setExportMsg({ ok: true, text: `Imported your Instagram data — ${f.toLocaleString('en-IN')} followers and ${s.posts ?? 0} posts on file.` });
        const d = await fetch(`/api/creator/setup${qs}`).then((res) => res.json());
        setData(d);
      } else {
        const reason = r?.reason as string | undefined;
        setExportMsg({
          ok: false,
          text: reason === 'not_zip'
            ? 'That’s not a ZIP file — upload the .zip Instagram emailed you.'
            : reason === 'unparseable'
            ? 'We couldn’t read that export. Make sure you chose JSON (not HTML) format when downloading.'
            : reason === 'too_large'
            ? 'That file is too large. Request a media-free export, or contact us to import it.'
            : 'Couldn’t import that file — please try again.',
        });
      }
    } catch {
      setExportMsg({ ok: false, text: 'Something went wrong during import. Please try again.' });
    } finally {
      setExportBusy(false);
    }
  };

  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator';
  const r = 52, circ = 2 * Math.PI * r;
  const score = data?.score ?? 0;

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors duration-200 mb-5">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
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
                    className="mt-3 inline-block px-4 py-2 text-[13px] font-semibold text-white rounded-xl transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5"
                    style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                    Next: {data.next.label} →
                  </Link>
                )}
              </div>
            </div>

            {/* Verify your Instagram — self-serve, no Meta App Review */}
            {data.verification && (
              <div className="mt-5 rounded-2xl bg-white border border-border shadow-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full"
                        style={data.verification.verified
                          ? { background: '#ecfdf3', color: '#16a34a' }
                          : { background: ACCENT_SOFT, color: ACCENT }}>
                        {data.verification.verified && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        )}
                        {data.verification.label}
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] text-ink-600 leading-relaxed">{data.verification.description}</p>
                  </div>
                </div>

                {/* Strength bar */}
                <div className="mt-3 h-1.5 rounded-full bg-[#eee9fb] overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${data.verification.strength}%`, background: `linear-gradient(90deg, ${ACCENT}, #9b7bff)` }} />
                </div>

                {data.verification.next_hint && (
                  <p className="mt-3 text-[12.5px] text-ink-500">{data.verification.next_hint}</p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button onClick={enrich} disabled={enriching}
                    className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white rounded-xl transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
                    style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                    {enriching && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                    {enriching ? 'Checking…' : 'Fetch my public stats'}
                  </button>
                  <Link href={withHandle('/connect', handle)} className="text-[12.5px] font-medium text-ink-500 hover:text-ink-900 transition-colors">
                    Connect Instagram for live insights <span className="text-ink-400">(optional)</span>
                  </Link>
                </div>

                {enrichMsg && (
                  <p className="mt-3 text-[12.5px] font-medium" style={{ color: enrichMsg.ok ? '#16a34a' : '#dc2626' }}>{enrichMsg.text}</p>
                )}

                {/* Handle ownership — prove you control the account, no login needed */}
                <div className="mt-4 pt-4 border-t border-[#f0edfa]">
                  {data.handle_verified ? (
                    <div className="flex items-center gap-2 text-[12.5px] font-medium" style={{ color: '#16a34a' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      Handle ownership verified — brands can see this account is really yours.
                    </div>
                  ) : !ownOpen ? (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-[12.5px] text-ink-600">Prove you own this handle — no Instagram login needed.</div>
                      <button onClick={startOwnership} className="text-[12.5px] font-semibold" style={{ color: ACCENT }}>Verify ownership →</button>
                    </div>
                  ) : (
                    <div>
                      <div className="text-[12.5px] text-ink-600 mb-2">Add this code anywhere in your Instagram bio, save it, then check:</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-[13px] font-bold tracking-wide px-3 py-1.5 rounded-lg select-all" style={{ background: ACCENT_SOFT, color: ACCENT }}>{ownCode ?? '…'}</code>
                        {ownCode && (
                          <button onClick={() => navigator.clipboard?.writeText(ownCode).catch(() => {})} className="text-[12px] font-medium text-ink-500 hover:text-ink-900 transition-colors">Copy</button>
                        )}
                        <button onClick={confirmOwnership} disabled={ownChecking || !ownCode}
                          className="inline-flex items-center gap-2 px-3.5 py-1.5 text-[12.5px] font-semibold text-white rounded-lg transition-all duration-200 hover:brightness-105 disabled:opacity-60"
                          style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                          {ownChecking && <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                          {ownChecking ? 'Checking…' : 'I’ve added it — check'}
                        </button>
                      </div>
                      <p className="mt-2 text-[11.5px] text-ink-400">You can remove the code from your bio once it’s verified.</p>
                    </div>
                  )}
                  {ownMsg && (
                    <p className="mt-2.5 text-[12.5px] font-medium" style={{ color: ownMsg.ok ? '#16a34a' : '#dc2626' }}>{ownMsg.text}</p>
                  )}
                </div>

                {/* ML insights unlock — once public reels are on file, the creator's
                    own reel-view predictions + content insights are ready. No IG
                    login, no App Review: it all runs off the login-free fetch. */}
                {data.verification.verified && (
                  <Link href={withHandle('/creator/analytics-preview', handle)}
                    className="group mt-4 flex items-center gap-3 rounded-xl border border-[#e3def9] bg-[#faf9ff] p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(108,77,246,0.14)]">
                    <span className="grid place-items-center w-9 h-9 shrink-0 rounded-lg text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-ink-900">See my reel predictions & insights</span>
                      <span className="block text-[12px] text-ink-500">AI forecast of your next reel’s views, trend and best-performing format — from your public reels.</span>
                    </span>
                    <svg className="shrink-0 text-ink-300 transition-transform duration-200 group-hover:translate-x-0.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                  </Link>
                )}
                {data.verification.verified && (
                  <Link href={withHandle('/creator/reel-predictor', handle)}
                    className="group mt-2.5 flex items-center gap-3 rounded-xl border border-[#e3def9] bg-[#faf9ff] p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(108,77,246,0.14)]">
                    <span className="grid place-items-center w-9 h-9 shrink-0 rounded-lg text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5v14l11-7z" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-ink-900">Predict my next reel</span>
                      <span className="block text-[12px] text-ink-500">Forecast views, likes and engagement before you post — with a caption + timing idea.</span>
                    </span>
                    <svg className="shrink-0 text-ink-300 transition-transform duration-200 group-hover:translate-x-0.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                  </Link>
                )}
              </div>
            )}

            {/* Upload your Instagram data export — self-sourced reach, no Meta */}
            <div className="mt-5 rounded-2xl bg-white border border-border shadow-card p-5">
              <div className="flex items-start gap-3">
                <span className="grid place-items-center w-9 h-9 shrink-0 rounded-lg text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink-900">Upload your Instagram data export</div>
                  <p className="mt-1 text-[12.5px] text-ink-500 leading-relaxed">Hand us your own Instagram data for exact follower counts and posting history — no login, no permissions.</p>
                </div>
              </div>

              {exportSummary && (
                <div className="mt-3.5 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Followers', value: exportSummary.followers },
                    { label: 'Posts', value: exportSummary.posts },
                    { label: 'Posts / 30d', value: exportSummary.posts_last_30d },
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl bg-[#faf9ff] border border-[#eee9fb] px-3 py-2.5 text-center">
                      <div className="text-[16px] font-bold tabular-nums text-ink-900">{m.value != null ? Number(m.value).toLocaleString('en-IN') : '—'}</div>
                      <div className="text-[10.5px] uppercase tracking-wide text-ink-400 mt-0.5">{m.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {!exportOpen && !exportSummary ? (
                <button onClick={() => setExportOpen(true)} className="mt-3.5 text-[12.5px] font-semibold" style={{ color: ACCENT }}>
                  How do I get my data? →
                </button>
              ) : null}

              {(exportOpen || exportSummary) && (
                <ol className="mt-3.5 space-y-1.5 text-[12px] text-ink-500 list-decimal pl-4">
                  <li>On Instagram: <span className="text-ink-700 font-medium">Settings → Accounts Centre → Your information and permissions → Download your information</span>.</li>
                  <li>Choose <span className="text-ink-700 font-medium">JSON</span> format (not HTML), all date ranges.</li>
                  <li>Instagram emails you a ZIP — upload it below.</li>
                </ol>
              )}

              <div className="mt-3.5 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white rounded-xl cursor-pointer transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5 disabled:opacity-60"
                  style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)`, opacity: exportBusy ? 0.6 : 1, pointerEvents: exportBusy ? 'none' : 'auto' }}>
                  {exportBusy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                  {exportBusy ? 'Importing…' : exportSummary ? 'Re-upload export' : 'Upload export (.zip)'}
                  <input type="file" accept=".zip,application/zip" className="hidden" disabled={exportBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadExport(f); e.target.value = ''; }} />
                </label>
                {exportSummary?.imported_at && (
                  <span className="text-[11.5px] text-ink-400">Imported {new Date(exportSummary.imported_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                )}
              </div>

              {exportMsg && (
                <p className="mt-3 text-[12.5px] font-medium" style={{ color: exportMsg.ok ? '#16a34a' : '#dc2626' }}>{exportMsg.text}</p>
              )}
            </div>

            {/* Checklist */}
            <div className="mt-5 space-y-2.5">
              {data.items.map((it) => (
                <Link key={it.key} href={withHandle(it.href, handle)}
                  className="group flex items-start gap-3.5 rounded-2xl bg-white border border-border shadow-card p-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]">
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
