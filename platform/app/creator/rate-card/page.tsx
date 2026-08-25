'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

type RateItemKey = 'reel' | 'feed_post' | 'story_set' | 'carousel' | 'ugc';
interface RateItem {
  key: RateItemKey;
  label: string;
  blurb: string;
  suggested: number;
  rate: number;
  custom: boolean;
  enabled: boolean;
}
interface RatePackage { key: string; label: string; contents: string; list_total: number; price: number; saving: number }
interface RateCard {
  available: boolean;
  currency: 'INR';
  follower_count: number;
  engagement_rate: number;
  tier: string;
  tier_label: string;
  has_custom: boolean;
  items: RateItem[];
  packages: RatePackage[];
  note: string | null;
  headline: string;
  basis: string;
}

const money = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');

export default function RateCardPage() {
  return (
    <Suspense fallback={null}>
      <RateCardView />
    </Suspense>
  );
}

function RateCardView() {
  const [handle, setHandle] = useState<string | null>(null);
  const [qs, setQs] = useState('');
  const [data, setData] = useState<RateCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // Draft edits keyed by item.
  const [rates, setRates] = useState<Partial<Record<RateItemKey, string>>>({});
  const [enabled, setEnabled] = useState<Partial<Record<RateItemKey, boolean>>>({});
  const [note, setNote] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    const query = h ? `?handle=${encodeURIComponent(h.replace(/^@/, ''))}` : '';
    setQs(query);
    fetch(`/api/creator/rate-card${query}`)
      .then((r) => r.json())
      .then((d: RateCard) => { setData(d); seedDraft(d); })
      .catch(() => setData({ available: false } as RateCard))
      .finally(() => setLoading(false));
  }, []);

  const seedDraft = (d: RateCard): void => {
    if (!d.items) return;
    const r: Partial<Record<RateItemKey, string>> = {};
    const e: Partial<Record<RateItemKey, boolean>> = {};
    for (const it of d.items) {
      r[it.key] = it.custom ? String(it.rate) : '';
      e[it.key] = it.enabled;
    }
    setRates(r); setEnabled(e); setNote(d.note ?? '');
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const ratesPayload: Partial<Record<RateItemKey, number | null>> = {};
      for (const k of Object.keys(rates) as RateItemKey[]) {
        const v = (rates[k] ?? '').trim();
        ratesPayload[k] = v === '' ? null : Number(v);
      }
      const res = await fetch(`/api/creator/rate-card${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: ratesPayload, enabled, note }),
      });
      const d = (await res.json()) as RateCard;
      if (d.available) { setData(d); seedDraft(d); setEditing(false); }
    } catch {
      /* keep editing */
    } finally {
      setSaving(false);
    }
  };

  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator';

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <PageDoodles className="-z-10" />
      <div className="print:hidden"><MarketingNav /></div>
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <div className="print:hidden">
          <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors duration-200 mb-5">
            <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold text-ink-900">Your rate card</h1>
          <p className="mt-1.5 text-[14px] text-ink-600">What you charge per deliverable — send this to brands so pricing never stalls a deal.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <h2 className="text-[16px] font-semibold text-ink-900">Profile not found</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500">Open the portal with your handle to build a rate card.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {/* Summary strip */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-5 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mb-1.5" style={{ color: ACCENT, background: ACCENT_SOFT }}>{data.tier_label}</span>
                <div className="text-[15px] font-bold text-ink-900">{data.headline}</div>
                <div className="text-[12px] text-ink-500 mt-0.5">{data.basis}</div>
              </div>
              {!editing && (
                <button onClick={() => setEditing(true)} className="shrink-0 px-4 py-2 text-sm font-semibold rounded-xl border border-border text-ink-700 hover:border-[#d9d4f5] transition-colors duration-200">
                  Edit rates
                </button>
              )}
            </div>

            {/* Items */}
            <div className="space-y-3">
              {data.items.map((it) => {
                const isEnabled = editing ? (enabled[it.key] ?? it.enabled) : it.enabled;
                if (!editing && !isEnabled) return null;
                return (
                  <div key={it.key} className={`rounded-2xl bg-white border border-border shadow-card p-4 ${!isEnabled ? 'opacity-55' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-ink-900">{it.label}</div>
                        <div className="text-[12.5px] text-ink-500">{it.blurb}</div>
                      </div>
                      {editing ? (
                        <label className="flex items-center gap-1.5 text-[12px] text-ink-500 shrink-0 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={enabled[it.key] ?? it.enabled}
                            onChange={(e) => setEnabled((p) => ({ ...p, [it.key]: e.target.checked }))}
                            className="accent-[#6C4DF6] w-4 h-4"
                          />
                          Show
                        </label>
                      ) : (
                        <div className="text-[17px] font-bold text-ink-900 tabular-nums shrink-0">{money(it.rate)}</div>
                      )}
                    </div>
                    {editing && (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-[14px]">₹</span>
                          <input
                            value={rates[it.key] ?? ''}
                            onChange={(e) => setRates((p) => ({ ...p, [it.key]: e.target.value.replace(/[^\d]/g, '') }))}
                            inputMode="numeric"
                            placeholder={`Suggested ${money(it.suggested)}`}
                            className="w-full rounded-lg border border-border pl-7 pr-3 py-2 text-[14px] text-ink-900 tabular-nums focus:outline-none focus:border-[#b9aef0]"
                          />
                        </div>
                        {(rates[it.key] ?? '') !== '' && (
                          <button onClick={() => setRates((p) => ({ ...p, [it.key]: '' }))} className="text-[12px] font-semibold text-ink-500 shrink-0">Reset</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Packages */}
            {!editing && data.packages.length > 0 && (
              <section>
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Bundle packages</h2>
                <div className="space-y-3">
                  {data.packages.map((p) => (
                    <div key={p.key} className="rounded-2xl border border-border p-4 flex items-center justify-between gap-3" style={{ background: ACCENT_SOFT }}>
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-ink-900">{p.label}</div>
                        <div className="text-[12.5px] text-ink-600">{p.contents}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[17px] font-bold tabular-nums" style={{ color: ACCENT }}>{money(p.price)}</div>
                        {p.saving > 0 && <div className="text-[11.5px] text-ink-500 line-through tabular-nums">{money(p.list_total)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Note */}
            {editing ? (
              <div className="rounded-2xl bg-white border border-border shadow-card p-4">
                <label className="block text-[13px] font-semibold text-ink-800 mb-1.5">Note to brands (optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 280))}
                  rows={3}
                  placeholder="e.g. Rates are for one platform; add-ons (whitelisting, exclusivity) quoted separately."
                  className="w-full rounded-lg border border-border px-3 py-2.5 text-[13.5px] text-ink-900 focus:outline-none focus:border-[#b9aef0] resize-none"
                />
                <div className="mt-0.5 text-right text-[11px] text-ink-400 tabular-nums">{note.length}/280</div>
              </div>
            ) : data.note ? (
              <div className="rounded-2xl p-4 text-[13px] text-ink-700 bg-white border border-border">{data.note}</div>
            ) : null}

            {editing ? (
              <div className="flex items-center gap-3">
                <button onClick={save} disabled={saving} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5 disabled:opacity-60" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                  {saving ? 'Saving…' : 'Save rate card'}
                </button>
                <button onClick={() => { setEditing(false); seedDraft(data); }} className="text-[13px] font-semibold text-ink-500">Cancel</button>
              </div>
            ) : (
              <div className="print:hidden flex justify-end">
                <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl border border-border text-ink-700 hover:border-[#d9d4f5] transition-colors duration-200">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>
                  Save as PDF
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
