'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface PlanInfo { name: string; price: number; credits: string }
const PLANS: Record<string, PlanInfo> = {
  free: { name: 'Free', price: 0, credits: '100 credits (one-time)' },
  startup: { name: 'Startup', price: 6999, credits: '6,999 credits / mo' },
  growth: { name: 'Growth', price: 19999, credits: '21,999 credits / mo' },
};
const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

type Method = 'upi' | 'credit' | 'debit' | 'netbanking';
const METHODS: { id: Method; label: string; icon: string }[] = [
  { id: 'upi', label: 'UPI', icon: 'upi' },
  { id: 'credit', label: 'Credit card', icon: 'card' },
  { id: 'debit', label: 'Debit card', icon: 'card' },
  { id: 'netbanking', label: 'Net banking', icon: 'bank' },
];
const BANKS = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra', 'Yes Bank'];

export default function CheckoutPage() {
  const [planKey, setPlanKey] = useState<string>('growth');
  const [method, setMethod] = useState<Method>('upi');
  const [done, setDone] = useState(false);
  const [processing, setProcessing] = useState(false);
  // method fields (never leave the browser — demo only)
  const [upi, setUpi] = useState('');
  const [card, setCard] = useState({ name: '', number: '', expiry: '', cvv: '' });
  const [bank, setBank] = useState('');

  useEffect(() => {
    const p = (new URLSearchParams(window.location.search).get('plan') ?? 'growth').toLowerCase();
    if (PLANS[p]) setPlanKey(p);
  }, []);

  const plan = PLANS[planKey] ?? PLANS.growth!;
  const isFree = plan.price === 0;

  const canPay = (() => {
    if (isFree) return true;
    if (method === 'upi') return /.+@.+/.test(upi.trim());
    if (method === 'netbanking') return !!bank;
    return card.name.trim() && card.number.replace(/\s/g, '').length >= 12 && /^\d{2}\/\d{2}$/.test(card.expiry) && card.cvv.length >= 3;
  })();

  function pay() {
    if (!canPay) return;
    setProcessing(true);
    setTimeout(() => { setProcessing(false); setDone(true); }, 900);
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col bg-white font-sans">
        <MarketingNav />
        <main className="flex-1 grid place-items-center px-6 py-20">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 mx-auto rounded-full grid place-items-center text-white text-2xl mb-5" style={{ background: '#10b981' }}>✓</div>
            <h1 className="text-2xl font-bold text-ink-900">{isFree ? 'Plan activated!' : 'Payment successful'}</h1>
            <p className="mt-2 text-[15px] text-ink-600">Your <span className="font-semibold capitalize">{plan.name}</span> plan is now active{!isFree && ` — ${inr(plan.price)} ${planBilling()}`}.</p>
            <Link href="/lander" className="inline-block mt-7 px-6 py-3 rounded-xl text-white text-[15px] font-semibold bg-ink-900 hover:bg-ink-800">Go to dashboard</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-6 py-10 grid md:grid-cols-[1.4fr_1fr] gap-8 items-start">
          {/* Payment */}
          <div>
            <Link href="/pricing" className="text-[13px] text-ink-500 hover:text-ink-900">← Back to plans</Link>
            <h1 className="mt-3 text-2xl font-bold text-ink-900">Checkout</h1>
            <p className="text-[14px] text-ink-600 mt-1">Choose how you’d like to pay for the {plan.name} plan.</p>

            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2">Demo checkout — no real payment is processed and no card details are stored or sent anywhere.</div>

            {isFree ? (
              <div className="mt-6 rounded-2xl border border-border bg-white shadow-card p-6 text-center">
                <div className="text-[15px] text-ink-700">The Free plan costs <span className="font-semibold">₹0</span>. Nothing to pay — just activate it.</div>
                <button onClick={pay} className="mt-4 px-6 py-3 rounded-xl text-white text-[14px] font-semibold bg-ink-900 hover:bg-ink-800">Activate free plan</button>
              </div>
            ) : (
              <>
                {/* method tiles */}
                <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {METHODS.map((m) => (
                    <button key={m.id} onClick={() => setMethod(m.id)} className={`flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-colors ${method === m.id ? '' : 'border-border hover:border-ink-300'}`} style={method === m.id ? { borderColor: ACCENT, background: ACCENT_SOFT } : undefined}>
                      <span style={{ color: method === m.id ? ACCENT : '#6b7280' }}><MethodIcon name={m.icon} /></span>
                      <span className="text-[12.5px] font-medium text-ink-800">{m.label}</span>
                    </button>
                  ))}
                </div>

                {/* method fields */}
                <div className="mt-4 rounded-2xl border border-border bg-white shadow-card p-5">
                  {method === 'upi' && (
                    <Field label="UPI ID"><input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@okhdfc" className={inp} /></Field>
                  )}
                  {(method === 'credit' || method === 'debit') && (
                    <div className="space-y-3">
                      <Field label="Cardholder name"><input value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} placeholder="Name on card" className={inp} /></Field>
                      <Field label="Card number"><input value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value.replace(/[^\d ]/g, '').slice(0, 19) })} inputMode="numeric" placeholder="1234 5678 9012 3456" className={inp} /></Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Expiry (MM/YY)"><input value={card.expiry} onChange={(e) => setCard({ ...card, expiry: e.target.value.replace(/[^\d/]/g, '').slice(0, 5) })} placeholder="08/27" className={inp} /></Field>
                        <Field label="CVV"><input value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" placeholder="123" className={inp} /></Field>
                      </div>
                    </div>
                  )}
                  {method === 'netbanking' && (
                    <Field label="Choose your bank"><select value={bank} onChange={(e) => setBank(e.target.value)} className={inp}><option value="">Select bank…</option>{BANKS.map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
                  )}
                </div>

                <button onClick={pay} disabled={!canPay || processing} className="mt-4 w-full px-6 py-3.5 rounded-xl text-white text-[15px] font-semibold bg-ink-900 hover:bg-ink-800 disabled:opacity-50 transition-colors">
                  {processing ? 'Processing…' : `Pay ${inr(plan.price)}`}
                </button>
                <p className="mt-2 text-[11px] text-ink-400 text-center">🔒 You can cancel anytime. By paying you agree to our terms.</p>
              </>
            )}
          </div>

          {/* Order summary */}
          <div className="rounded-2xl border border-border bg-[#f7f7fb] p-6 md:sticky md:top-24">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Order summary</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[16px] font-bold text-ink-900 capitalize">{plan.name} plan</div>
                <div className="text-[12px] text-ink-500">{plan.credits}</div>
              </div>
              <div className="text-[18px] font-bold text-ink-900">{isFree ? '₹0' : inr(plan.price)}</div>
            </div>
            <div className="my-4 h-px bg-border" />
            <div className="flex items-center justify-between text-[13px] text-ink-600"><span>Subtotal</span><span>{isFree ? '₹0' : inr(plan.price)}</span></div>
            <div className="flex items-center justify-between text-[13px] text-ink-600 mt-1.5"><span>GST (18%)</span><span>{isFree ? '₹0' : inr(Math.round(plan.price * 0.18))}</span></div>
            <div className="my-4 h-px bg-border" />
            <div className="flex items-center justify-between"><span className="font-semibold text-ink-900">Total {!isFree && <span className="text-[12px] font-normal text-ink-400">{planBilling()}</span>}</span><span className="text-xl font-bold" style={{ color: ACCENT }}>{isFree ? '₹0' : inr(Math.round(plan.price * 1.18))}</span></div>
          </div>
        </div>
      </main>
    </div>
  );
}

function planBilling() { return '/ month'; }

const inp = 'w-full px-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[12px] text-ink-500 mb-1 block">{label}</span>{children}</label>;
}

function MethodIcon({ name }: { name: string }) {
  const c = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'card') return (<svg {...c}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>);
  if (name === 'bank') return (<svg {...c}><path d="M3 10l9-6 9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18" /></svg>);
  return (<svg {...c}><path d="M4 7h16v10H4zM4 11h16" /><circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" /></svg>);
}
