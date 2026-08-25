'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

type Method = 'upi' | 'bank';
type ErrKey = 'method' | 'upi_id' | 'account_holder' | 'account_number' | 'ifsc';

interface PayoutDisplay {
  method: Method;
  upi_id: string | null;
  account_holder: string | null;
  account_last4: string | null;
  ifsc: string | null;
  updated_at: string | null;
  complete: boolean;
}

const dateStr = (s: string | null): string => {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function PayoutPage() {
  return (
    <Suspense fallback={null}>
      <Payout />
    </Suspense>
  );
}

function Payout() {
  const [handle, setHandle] = useState<string | null>(null);
  const [qs, setQs] = useState('');
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<PayoutDisplay | null>(null);
  const [method, setMethod] = useState<Method>('upi');
  const [form, setForm] = useState({ upi_id: '', account_holder: '', account_number: '', ifsc: '' });
  const [errors, setErrors] = useState<Partial<Record<ErrKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    const query = h ? `?handle=${encodeURIComponent(h.replace(/^@/, ''))}` : '';
    setQs(query);
    fetch(`/api/creator/payout${query}`)
      .then((r) => r.json())
      .then((d: { available: boolean; payout?: PayoutDisplay | null }) => {
        if (d.payout) {
          setCurrent(d.payout);
          setMethod(d.payout.method);
          setForm({
            upi_id: d.payout.upi_id ?? '',
            account_holder: d.payout.account_holder ?? '',
            account_number: '',
            ifsc: d.payout.ifsc ?? '',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (k: keyof typeof form, v: string): void => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaved(false);
    try {
      const payload = method === 'upi'
        ? { method, upi_id: form.upi_id }
        : { method, account_holder: form.account_holder, account_number: form.account_number, ifsc: form.ifsc };
      const res = await fetch(`/api/creator/payout${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = (await res.json()) as { saved?: boolean; payout?: PayoutDisplay; errors?: Partial<Record<ErrKey, string>> };
      if (d.errors && Object.keys(d.errors).length) {
        setErrors(d.errors);
      } else if (d.saved && d.payout) {
        setCurrent(d.payout);
        setForm((f) => ({ ...f, account_number: '' }));
        setSaved(true);
      }
    } catch {
      /* retry */
    } finally {
      setSaving(false);
    }
  };

  const backHref = handle ? `/creator/settings?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : '/creator/settings';

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1 max-w-xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors duration-200 mb-5">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to settings
        </Link>

        <h1 className="text-2xl font-bold text-ink-900">Payout details</h1>
        <p className="mt-1.5 text-[14px] text-ink-600">Where your deal payments should land. Stored securely and shared only with brands paying you.</p>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : (
          <div className="mt-6 space-y-5">
            {/* Current on file */}
            {current?.complete && (
              <div className="rounded-2xl border shadow-card p-4" style={{ borderColor: ACCENT, background: ACCENT_SOFT }}>
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: ACCENT }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  On file
                </div>
                <div className="mt-1.5 text-[14px] font-semibold text-ink-900">
                  {current.method === 'upi'
                    ? `UPI · ${current.upi_id}`
                    : `Bank · ${current.account_holder} · ****${current.account_last4} · ${current.ifsc}`}
                </div>
                {current.updated_at && <div className="text-[11.5px] text-ink-500 mt-0.5">Updated {dateStr(current.updated_at)}</div>}
              </div>
            )}

            {/* Method toggle */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-5">
              <div className="grid grid-cols-2 gap-2 mb-5">
                {(['upi', 'bank'] as Method[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMethod(m); setSaved(false); setErrors({}); }}
                    className="py-2.5 rounded-xl text-[13.5px] font-semibold border transition-colors"
                    style={method === m
                      ? { color: '#fff', background: ACCENT, borderColor: ACCENT }
                      : { color: '#4b4b63', background: '#fff', borderColor: '#e6e4f0' }}
                  >
                    {m === 'upi' ? 'UPI' : 'Bank transfer'}
                  </button>
                ))}
              </div>

              {method === 'upi' ? (
                <Field label="UPI ID" hint="e.g. yourname@okaxis, 98765xxxxx@ybl">
                  <input value={form.upi_id} onChange={(e) => set('upi_id', e.target.value)} placeholder="yourname@okaxis"
                    className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 focus:outline-none focus:border-[#b9aef0]" />
                  <Err msg={errors.upi_id} />
                </Field>
              ) : (
                <div className="space-y-4">
                  <Field label="Account holder name">
                    <input value={form.account_holder} onChange={(e) => set('account_holder', e.target.value)} placeholder="As per bank records"
                      className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 focus:outline-none focus:border-[#b9aef0]" />
                    <Err msg={errors.account_holder} />
                  </Field>
                  <Field label="Account number" hint={current?.account_last4 ? `Currently ending ${current.account_last4} — re-enter to change.` : undefined}>
                    <input value={form.account_number} onChange={(e) => set('account_number', e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="6–18 digits"
                      className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 tabular-nums focus:outline-none focus:border-[#b9aef0]" />
                    <Err msg={errors.account_number} />
                  </Field>
                  <Field label="IFSC code">
                    <input value={form.ifsc} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} placeholder="HDFC0001234"
                      className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-ink-900 uppercase tracking-wide focus:outline-none focus:border-[#b9aef0]" />
                    <Err msg={errors.ifsc} />
                  </Field>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving}
                className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5 disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                {saving ? 'Saving…' : 'Save payout method'}
              </button>
              {saved && <span className="text-[13px] font-semibold px-2.5 py-1 rounded-lg" style={{ color: '#16a34a', background: '#ecfdf3' }}>✓ Saved</span>}
            </div>

            <p className="text-[11.5px] text-ink-400 flex items-start gap-1.5">
              <svg className="mt-0.5 shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Your account number is never shown again after saving — only the last 4 digits are displayed.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-ink-800">{label}</label>
      {hint && <div className="text-[11.5px] text-ink-400 mb-1.5">{hint}</div>}
      {!hint && <div className="mb-1.5" />}
      {children}
    </div>
  );
}
function Err({ msg }: { msg?: string }) {
  return <div className="mt-1 text-[11.5px]" style={{ color: msg ? '#dc2626' : 'transparent', minHeight: '1em' }}>{msg || '.'}</div>;
}
