'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

const SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'];

export default function BookDemoPage() {
  const [form, setForm] = useState({ name: '', email: '', company: '', size: '', goal: '' });
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.name.trim() && /.+@.+\..+/.test(form.email) && form.company.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (valid) setDone(true);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-5xl mx-auto px-6 py-14 grid md:grid-cols-2 gap-10 items-start">
            {/* Pitch */}
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Book a demo</span>
              <h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-tight">See Influencer Intel in action</h1>
              <p className="mt-4 text-[15px] text-ink-600">A 30-minute walkthrough tailored to your brand. We’ll show you AI discovery, campaign management, and verified creator analytics on real data.</p>
              <ul className="mt-6 space-y-3">
                {['Personalized to your category & goals', 'See discovery, scoring & payouts live', 'Get a tailored pricing recommendation'].map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-[14px] text-ink-700">
                    <span className="w-[18px] h-[18px] mt-0.5 shrink-0 rounded-full grid place-items-center text-white text-[11px]" style={{ background: ACCENT }}>✓</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* Form / success */}
            <div className="rounded-2xl bg-white border border-border shadow-card p-6">
              {done ? (
                <div className="py-10 text-center">
                  <div className="w-12 h-12 mx-auto rounded-full grid place-items-center text-white text-xl mb-4" style={{ background: '#10b981' }}>✓</div>
                  <h2 className="text-xl font-bold text-ink-900">Thanks, {form.name.split(' ')[0]}!</h2>
                  <p className="mt-2 text-[14px] text-ink-600">We’ve got your request — our team will reach out at <span className="font-medium text-ink-800">{form.email}</span> within 24 hours.</p>
                  <Link href="/lander" className="inline-block mt-6 px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold bg-ink-900 hover:bg-ink-800">Back to home</Link>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <Field label="Full name"><input value={form.name} onChange={set('name')} placeholder="Aisha Kapoor" className={inp} /></Field>
                  <Field label="Work email"><input type="email" value={form.email} onChange={set('email')} placeholder="you@brand.com" className={inp} /></Field>
                  <Field label="Company"><input value={form.company} onChange={set('company')} placeholder="Brand name" className={inp} /></Field>
                  <Field label="Team size">
                    <select value={form.size} onChange={set('size')} className={inp}><option value="">Select…</option>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                  </Field>
                  <Field label="What are you hoping to do? (optional)"><textarea value={form.goal} onChange={set('goal')} rows={3} placeholder="e.g. run always-on micro-influencer campaigns" className={`${inp} resize-none`} /></Field>
                  <button type="submit" disabled={!valid} className="w-full px-4 py-3 rounded-xl text-white text-[14px] font-semibold bg-ink-900 hover:bg-ink-800 disabled:opacity-50 transition-colors">Request my demo</button>
                  <p className="text-[11px] text-ink-400 text-center">No spam. We’ll only use this to set up your demo.</p>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

const inp = 'w-full px-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[12px] text-ink-500 mb-1 block">{label}</span>{children}</label>;
}
