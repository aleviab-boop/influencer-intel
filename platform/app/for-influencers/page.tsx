'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MarketingNav, MarketingFooter, Reveal, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { CreatorToolkit } from '@/components/creator-toolkit';

export default function ForInfluencersPage() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl opacity-25" style={{ background: ACCENT }} />
          <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-14 text-center">
            <span className="inline-block px-4 py-1.5 rounded-full bg-white border border-border shadow-sm text-[13px] font-semibold" style={{ color: ACCENT }}>For creators</span>
            <h1 className="mt-6 text-4xl md:text-6xl font-bold tracking-tight text-ink-900 leading-[1.05]">
              Turn your influence<br />into <span style={{ color: ACCENT }}>income</span>
            </h1>
            <p className="mt-5 text-[17px] text-ink-600 max-w-2xl mx-auto">Join thousands of Indian creators getting matched with real brand campaigns. Set your rates, collaborate on your terms, and get paid on time — every time.</p>
            <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
              <Link href="/creator" className="px-6 py-3 rounded-xl text-white text-[15px] font-semibold bg-ink-900 hover:bg-ink-800 transition-colors">Create your profile</Link>
              <a href="#how-it-works" className="px-6 py-3 rounded-xl text-[15px] font-semibold border border-border hover:bg-[#faf9ff] transition-colors" style={{ color: ACCENT, borderColor: '#e3def9' }}>See how it works</a>
            </div>
            <p className="mt-3 text-[12px] text-ink-400">Free to join · No subscription · Keep 100% of your rate</p>
          </div>
        </section>

        {/* Stats band */}
        <section className="border-y border-border bg-[#fafafc]">
          <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {STATS.map((s) => (
              <div key={s.label}>
                <div className="text-3xl font-bold tabular-nums" style={{ color: ACCENT }}>{s.value}</div>
                <div className="text-[12px] uppercase tracking-wider text-ink-400 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-16 scroll-mt-20">
          <Reveal className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-ink-900">Start earning in 3 steps</h2>
            <p className="mt-2 text-[15px] text-ink-600">No agencies, no chasing payments — just collaborations that fit you.</p>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-5">
            {STEPS.map((s, i) => (
              <Reveal key={s.t} delay={i * 0.1}>
                <div className="relative rounded-2xl bg-white border border-border shadow-card p-6 h-full transition-all hover:-translate-y-1 hover:shadow-[0_14px_40px_rgba(108,77,246,0.12)]">
                  <div className="w-9 h-9 rounded-xl grid place-items-center text-white font-bold text-[15px] mb-4" style={{ background: ACCENT }}>{i + 1}</div>
                  <div className="font-semibold text-ink-900 text-[16px]">{s.t}</div>
                  <p className="mt-2 text-[13.5px] text-ink-500 leading-relaxed">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Benefits */}
        <section className="bg-[#fafafc] border-y border-border">
          <div className="max-w-6xl mx-auto px-6 py-16">
            <Reveal className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-ink-900">Why creators choose us</h2>
              <p className="mt-2 text-[15px] text-ink-600">Built to put creators first, not squeeze them.</p>
            </Reveal>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {BENEFITS.map((b, i) => (
                <Reveal key={b.t} delay={i * 0.08}>
                  <div className="rounded-2xl bg-white border border-border shadow-card p-5 h-full transition-all hover:-translate-y-1 hover:shadow-[0_14px_40px_rgba(108,77,246,0.12)]">
                    <div className="w-10 h-10 rounded-xl grid place-items-center mb-3" style={{ background: ACCENT_SOFT, color: ACCENT }}>{b.icon}</div>
                    <div className="font-semibold text-ink-900 text-[15px]">{b.t}</div>
                    <p className="mt-1 text-[13px] text-ink-500 leading-relaxed">{b.d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Creator toolkit — workload-reducing features */}
        <CreatorToolkit />

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-ink-900">Creator FAQs</h2>
            <p className="mt-2 text-[15px] text-ink-600">Everything you need to know before you join.</p>
          </div>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <div key={f.q} className="rounded-xl bg-white border border-border overflow-hidden">
                <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left">
                  <span className="text-[15px] font-semibold text-ink-900">{f.q}</span>
                  <svg className={`w-4 h-4 shrink-0 text-ink-400 transition-transform ${open === i ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
                </button>
                {open === i && <div className="px-5 pb-4 -mt-1 text-[14px] text-ink-600 leading-relaxed">{f.a}</div>}
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-5xl mx-auto px-6 pb-20">
          <div className="rounded-3xl px-8 py-14 text-center text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Your next brand deal is waiting</h2>
            <p className="mt-3 text-[16px] text-white/85 max-w-xl mx-auto">Create your profile in minutes and start getting matched with campaigns that fit your niche and your rate.</p>
            <Link href="/creator" className="inline-block mt-7 px-7 py-3.5 rounded-xl bg-white text-[15px] font-semibold" style={{ color: ACCENT }}>Join free as a creator</Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

const STATS = [
  { value: '12K+', label: 'creators onboarded' },
  { value: '₹4.8Cr', label: 'paid to creators' },
  { value: '48h', label: 'avg. brand match' },
  { value: '4.8/5', label: 'creator rating' },
];

const STEPS = [
  { t: 'Create your profile', d: 'Connect your Instagram or YouTube, set your niche, rates and the kinds of brands you love working with.' },
  { t: 'Get matched with brands', d: 'Our AI surfaces your profile to brands running relevant campaigns. Accept the briefs that excite you, skip the rest.' },
  { t: 'Create & get paid', d: 'Deliver the content, get it approved in-app, and receive your payout on time — tracked end to end, no follow-ups.' },
];

const I = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const BENEFITS = [
  { t: 'Free to join', d: 'No subscription, no joining fee. You only ever keep more of what you earn.', icon: <svg {...I}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg> },
  { t: 'Verified brands only', d: 'Every brand on the platform is vetted, so you never waste time on fake or flaky deals.', icon: <svg {...I}><circle cx="12" cy="8" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></svg> },
  { t: 'On-time payouts', d: 'Transparent rates agreed up front and payouts tracked in-app — paid on schedule, every time.', icon: <svg {...I}><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11h6M14 8c0 3-2 4-5 4l4 4" /></svg> },
  { t: 'Grow with insights', d: 'See how your engagement and authenticity score stacks up, and what brands look for.', icon: <svg {...I}><path d="M6 20V10M12 20V4M18 20v-6" /></svg> },
];

const FAQS = [
  { q: 'Does it cost anything to join?', a: 'No. Creating a profile and getting matched with brands is completely free — there’s no subscription or joining fee. You keep 100% of the rate you agree with a brand.' },
  { q: 'How do I get paid?', a: 'You agree a rate with the brand up front. Once your content is delivered and approved in-app, your payout is released on the agreed schedule and tracked end to end — no chasing.' },
  { q: 'How many followers do I need?', a: 'There’s no hard minimum. Brands run campaigns across every tier — from nano creators to celebrities. What matters most is genuine engagement and a clear niche.' },
  { q: 'Can I choose which brands I work with?', a: 'Always. You only ever accept the briefs you like. There’s no obligation to take any campaign, and you set the kinds of brands and content you’re open to.' },
  { q: 'Which platforms are supported?', a: 'Instagram and YouTube today, with more on the way. Connect your account to auto-fill your stats and get matched faster.' },
];
